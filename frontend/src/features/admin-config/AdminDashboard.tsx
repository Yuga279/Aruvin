/**
 * ============================================================================
 * FILE: AdminDashboard.tsx
 * LOCATION: frontend/src/features/admin-config/AdminDashboard.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Load/save orchestration for the Config, Plugins, and empty Analytics dashboard.
 *
 * ROLE IN PROJECT:
 *    Owns admin page state, section/tab navigation, unsaved-exit guards, and
 *    post-save capability refresh without mounting a second chat provider.
 *
 * KEY COMPONENTS:
 *    - Config/Plugins/Analytics tabs and section navigation
 *    - Settings save with revision fencing and in-flight click guard
 * ============================================================================
 */

import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { AdminConfigClient } from '../../api/admin-config-client.ts';
import { AdminConfigClientError } from '../../api/admin-config-client.ts';
import { createAdministrationClient, type AdministrationClient } from '../../api/administration-client.ts';
import type { AdminConfigError, AdminConfigFieldPath, PublicAdminConfig } from '../../api/admin-config-protocol.ts';
import type { AuthUser } from '../../api/auth-protocol.ts';
import { createCalendarClient, type CalendarClient } from '../../api/calendar-client.ts';
import type {
  CalendarOAuthCallbackOutcome,
  CalendarPublicStatus,
} from '../../api/calendar-protocol.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { GoogleCalendarPanel } from '../plugins/google-calendar/index.ts';
import { AdministrationPanel } from './AdministrationPanel.tsx';
import { ConfigFields, fieldDomId } from './ConfigFields.tsx';
import { CredentialRow } from './CredentialRow.tsx';
import {
  createEditState,
  editReducer,
  editableFields,
  errorCopy,
  fieldsFromSettings,
  isDirty,
  navigationDecision,
  settingsFromFields,
  type AdminSection,
  type AdminTab,
  type EditAction,
  type EditState,
} from './config-edit-state.ts';
import './admin-config.css';

export type PluginSection = 'calendar';
export type DashboardSection = AdminSection | PluginSection;

export type AdminDashboardProps = {
  client: AdminConfigClient;
  calendarClient?: CalendarClient;
  adminClient?: AdministrationClient;
  user?: AuthUser | null;
  onBackToChat: () => void;
  refreshCapabilities: () => Promise<boolean>;
  chatActive?: boolean;
  initialSection?: DashboardSection;
  initialCalendarStatus?: CalendarPublicStatus | null;
  oauthOutcome?: CalendarOAuthCallbackOutcome | null;
  onDismissOAuthOutcome?: () => void;
};

const CONFIG_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'chat', label: 'Chat limits' },
  { id: 'voice', label: 'Voice' },
  { id: 'deepgram', label: 'Deepgram' },
];
const PLUGIN_SECTIONS: { id: PluginSection; label: string }[] = [
  { id: 'calendar', label: 'Google Calendar' },
];
const SUPER_ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'administration', label: 'Administration' },
];

const USER_TABS: { id: AdminTab; label: string }[] = [
  { id: 'plugins', label: 'Plugins' },
];

function isPluginSection(id: DashboardSection): id is PluginSection {
  return id === 'calendar';
}

export function activationCopy(config: PublicAdminConfig): string {
  if (config.activation === 'active' && config.activeRevision === config.revision) {
    return 'Saved and active for new work';
  }
  if (config.activation === 'blocked') {
    return 'Saved. Activation is blocked. New work cannot use these settings yet.';
  }
  return 'Saved. Configuration is unconfigured until required keys are present.';
}

function saveLocked(state: EditState): boolean {
  return !isDirty(state) || state.pending !== null || state.stale || state.uncertain;
}

function fieldSection(path: string): AdminSection | null {
  return editableFields.find((field) => field.path === path)?.section ?? null;
}

function dashboardReducer(state: EditState | null, action: EditAction): EditState | null {
  if (!state) {
    if (action.type === 'loaded' || action.type === 'settingsSaved' || action.type === 'credentialSaved') {
      return createEditState(action.config);
    }
    return state;
  }
  return editReducer(state, action);
}

function sectionDirty(state: EditState, id: AdminSection): boolean {
  const original = fieldsFromSettings(state.baseline.settings);
  return editableFields.some((field) => field.section === id && state.fields[field.path] !== original[field.path]);
}

export function AdminDashboard({
  client,
  calendarClient,
  adminClient,
  user,
  onBackToChat,
  refreshCapabilities,
  chatActive = false,
  initialSection,
  initialCalendarStatus = null,
  oauthOutcome = null,
  onDismissOAuthOutcome,
}: AdminDashboardProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const inflight = useRef(false);
  const epochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const refreshEpoch = useRef(0);
  const isStandardUser = user?.role === 'user';
  const tabs = isStandardUser ? USER_TABS : SUPER_ADMIN_TABS;
  const [tab, setTab] = useState<AdminTab>(() => {
    if (isStandardUser) return 'plugins';
    return initialSection && isPluginSection(initialSection) ? 'plugins' : 'config';
  });
  const [section, setSection] = useState<AdminSection>(
    initialSection && !isPluginSection(initialSection) ? initialSection : 'openrouter',
  );
  const [plugin, setPlugin] = useState<PluginSection>(
    initialSection && isPluginSection(initialSection) ? initialSection : 'calendar',
  );
  const [defaultCalendarClient] = useState(() => createCalendarClient());
  const [defaultAdministrationClient] = useState(() => createAdministrationClient());
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>(() =>
    isStandardUser ? 'ready' : 'loading',
  );
  const [confirmDialog, setConfirmDialog] = useState<'leave' | 'reload' | null>(null);
  const [edit, dispatch] = useReducer(dashboardReducer, null);
  const ready = phase === 'ready' && edit !== null;
  const ids = useId();
  const dirty = ready ? isDirty(edit) : false;
  const pending = Boolean(edit?.pending);
  const mutationBusy = pending || credentialBusy || calendarBusy;

  useEffect(() => {
    if (!initialSection) return;
    if (isPluginSection(initialSection) || isStandardUser) {
      setTab('plugins');
      if (isPluginSection(initialSection)) setPlugin(initialSection);
      return;
    }
    setTab('config');
    setSection(initialSection);
  }, [initialSection, isStandardUser]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isStandardUser) {
      setPhase('ready');
      return;
    }
    const epoch = ++epochRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('loading');
    void client.read(abort.signal).then((config) => {
      if (epoch !== epochRef.current) return;
      dispatch({ type: 'loaded', config });
      setPhase('ready');
    }).catch(() => {
      if (epoch !== epochRef.current) return;
      setPhase('unavailable');
    });
    return () => {
      abort.abort();
      epochRef.current += 1;
      refreshEpoch.current += 1;
    };
  }, [client, isStandardUser]);

  useEffect(() => {
    if (!ready || (!dirty && !pending)) return undefined;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [ready, dirty, pending]);

  const leave = () => {
    if (mutationBusy) return;
    if (dirty) {
      setConfirmDialog('leave');
      return;
    }
    const decision = navigationDecision({ dirty, pending: mutationBusy }, () => true);
    if (decision === 'leave') onBackToChat();
  };

  const performReload = () => {
    const epoch = ++epochRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    void client.read(abort.signal).then((config) => {
      if (epoch !== epochRef.current) return;
      dispatch({ type: 'loaded', config });
      setPhase('ready');
    }).catch(() => {
      if (epoch !== epochRef.current) return;
      setPhase('unavailable');
    });
  };

  const reload = (confirmDiscard: boolean) => {
    if (confirmDiscard && dirty) {
      setConfirmDialog('reload');
      return;
    }
    performReload();
  };

  const selectTab = (next: AdminTab) => {
    setTab(next);
    queueMicrotask(() => document.getElementById(`${ids}-${next}-tab`)?.focus());
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTab(tabs[(index + 1) % tabs.length].id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTab(tabs[(index - 1 + tabs.length) % tabs.length].id);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab(tabs[0].id);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab(tabs[tabs.length - 1].id);
    }
  };

  const save = () => {
    if (!ready || inflight.current || saveLocked(edit)) return;
    const converted = settingsFromFields(edit.baseline.settings, edit.fields);
    if (!converted.settings) {
      dispatch({
        type: 'failed',
        error: {
          code: 'CONFIG_VALIDATION_FAILED',
          currentRevision: edit.baseline.revision,
          fieldErrors: converted.fieldErrors,
        },
      });
      queueMicrotask(() => {
        summaryRef.current?.focus();
        const first = converted.fieldErrors[0];
        if (first) document.getElementById(fieldDomId(first.path as AdminConfigFieldPath))?.focus();
      });
      return;
    }
    inflight.current = true;
    dispatch({ type: 'begin', scope: 'settings' });
    const epoch = ++refreshEpoch.current;
    void client.saveSettings({
      protocolVersion: 1,
      expectedRevision: edit.baseline.revision,
      settings: converted.settings,
    }).then(async (config) => {
      dispatch({ type: 'settingsSaved', config });
      const ok = await refreshCapabilities();
      if (epoch === refreshEpoch.current) dispatch({ type: 'capabilities', ok });
    }).catch((error: unknown) => {
      const failure = error instanceof AdminConfigClientError
        ? error
        : new AdminConfigClientError({ code: 'NETWORK_ERROR', uncertain: true });
      dispatch({
        type: 'failed',
        error: {
          code: failure.code,
          currentRevision: failure.currentRevision,
          fieldErrors: failure.fieldErrors,
          uncertain: failure.uncertain,
        },
      });
      queueMicrotask(() => summaryRef.current?.focus());
    }).finally(() => {
      inflight.current = false;
    });
  };

  const editingLocked = Boolean(edit?.pending || edit?.stale || edit?.uncertain);
  const errors: AdminConfigError['error']['fieldErrors'] = edit?.error?.fieldErrors ?? [];
  const hiddenErrors = errors.filter((error) => fieldSection(error.path) && fieldSection(error.path) !== section);

  return (
    <div className="aurvin-admin">
      <header className="aurvin-admin-header">
        <button type="button" className="aurvin-admin-back" onClick={leave} disabled={mutationBusy}>
          Back to chat
        </button>
        <h1 ref={headingRef} tabIndex={-1} className="aurvin-admin-title">Manage Aurvin</h1>
        {chatActive ? (
          <p className="aurvin-admin-continue" role="status">Chat/voice continues in the background</p>
        ) : null}
      </header>

      {phase === 'loading' ? <p role="status">Loading configuration</p> : null}
      {phase === 'unavailable' ? (
        <div role="alert">
          <p>Storage or configuration is unavailable.</p>
          <button type="button" onClick={() => reload(false)}>Retry</button>
        </div>
      ) : null}

      {phase !== 'unavailable' ? (
        <>
          <div
            className="aurvin-admin-tabs"
            role="tablist"
            aria-label="Manage Aurvin"
            onKeyDown={onTabKey}
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                id={`${ids}-${item.id}-tab`}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`${ids}-${item.id}-panel`}
                tabIndex={tab === item.id ? 0 : -1}
                disabled={mutationBusy}
                onClick={() => selectTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            id={`${ids}-config-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-config-tab`}
            hidden={tab !== 'config'}
          >
            <div className="aurvin-admin-config">
                <nav className="aurvin-admin-rail" aria-label="Settings sections">
                  {CONFIG_SECTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={section === item.id ? 'true' : undefined}
                      disabled={mutationBusy}
                      onClick={() => setSection(item.id)}
                    >
                      {item.label}
                      {edit && sectionDirty(edit, item.id) ? <span className="aurvin-admin-dirty">Unsaved</span> : null}
                    </button>
                  ))}
                </nav>
                <label className="aurvin-admin-section-select">
                  Section
                  <select
                    value={section}
                    disabled={mutationBusy}
                    onChange={(event) => setSection(event.target.value as AdminSection)}
                  >
                    {CONFIG_SECTIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <div className="aurvin-admin-main">
                  <h2 className="aurvin-admin-section-title">{CONFIG_SECTIONS.find((item) => item.id === section)?.label}</h2>
                  {ready ? (
                    <>
                      {section === 'openrouter' || section === 'deepgram' ? (
                        <CredentialRow
                          provider={section}
                          credential={edit.baseline.credentials[section]}
                          expectedRevision={edit.baseline.revision}
                          disabled={Boolean(edit.pending || edit.stale || edit.uncertain)}
                          client={client}
                          onBusy={setCredentialBusy}
                          onSaved={(config) => {
                            dispatch({ type: 'credentialSaved', config });
                            const epoch = ++refreshEpoch.current;
                            void refreshCapabilities().then((ok) => {
                              if (epoch === refreshEpoch.current) dispatch({ type: 'capabilities', ok });
                            });
                          }}
                          onFailure={(error) => dispatch({
                            type: 'failed',
                            error: {
                              code: error.code,
                              currentRevision: error.currentRevision,
                              fieldErrors: error.fieldErrors,
                              uncertain: error.uncertain,
                            },
                          })}
                        />
                      ) : null}
                      {errors.length > 0 ? (
                        <div ref={summaryRef} className="aurvin-admin-summary" role="alert" tabIndex={-1}>
                          <p>{edit.error ? errorCopy(edit.error.code) : 'Review the highlighted fields before saving.'}</p>
                          {hiddenErrors.map((error) => {
                            const target = fieldSection(error.path);
                            const label = CONFIG_SECTIONS.find((item) => item.id === target)?.label ?? error.path;
                            return (
                              <button key={`${error.path}-${error.code}`} type="button" onClick={() => {
                                if (target) setSection(target);
                              }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <ConfigFields
                        section={section}
                        fields={edit.fields}
                        errors={errors}
                        disabled={editingLocked}
                        onChange={(path, value) => dispatch({ type: 'edit', path, value })}
                      />
                      <div className="aurvin-admin-save-row">
                        <p role="status" aria-live="polite">
                          {edit.pending ? 'Saving' : dirty ? 'Unsaved changes' : activationCopy(edit.baseline)}
                        </p>
                        <p className="aurvin-admin-help">
                          Save changes writes nonsecret edits across sections. It does not save provider keys.
                        </p>
                        {mutationBusy ? <p>Wait for the save to finish</p> : null}
                        <button
                          type="button"
                          className="aurvin-admin-save"
                          disabled={saveLocked(edit)}
                          onClick={save}
                        >
                          Save changes
                        </button>
                        {edit.stale || edit.uncertain ? (
                          <button type="button" onClick={() => reload(true)}>Reload saved settings</button>
                        ) : null}
                        {edit.capabilityWarning ? (
                          <>
                            <p role="status">Saved. Voice availability could not be refreshed. Retry voice refresh before starting a new session.</p>
                            <button type="button" onClick={() => {
                              const epoch = ++refreshEpoch.current;
                              void refreshCapabilities().then((ok) => {
                                if (epoch === refreshEpoch.current) dispatch({ type: 'capabilities', ok });
                              });
                            }}>Retry voice refresh</button>
                          </>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
          </div>

          <div
            id={`${ids}-plugins-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-plugins-tab`}
            hidden={tab !== 'plugins'}
          >
            <div className="aurvin-admin-config">
              <nav className="aurvin-admin-rail" aria-label="Plugin sections">
                {PLUGIN_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={plugin === item.id ? 'true' : undefined}
                    disabled={mutationBusy}
                    onClick={() => setPlugin(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <label className="aurvin-admin-section-select">
                Plugin
                <select
                  value={plugin}
                  disabled={mutationBusy}
                  onChange={(event) => setPlugin(event.target.value as PluginSection)}
                >
                  {PLUGIN_SECTIONS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <div className="aurvin-admin-main">
                <h2 className="aurvin-admin-section-title">{PLUGIN_SECTIONS.find((item) => item.id === plugin)?.label}</h2>
                {tab === 'plugins' && plugin === 'calendar' ? (
                  <GoogleCalendarPanel
                    client={calendarClient ?? defaultCalendarClient}
                    initialStatus={initialCalendarStatus}
                    oauthOutcome={oauthOutcome}
                    onDismissOAuthOutcome={onDismissOAuthOutcome}
                    disabled={editingLocked}
                    onBusy={setCalendarBusy}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div
            id={`${ids}-analytics-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-analytics-tab`}
            hidden={tab !== 'analytics'}
          />

          <div
            id={`${ids}-administration-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-administration-tab`}
            hidden={tab !== 'administration'}
          >
            {tab === 'administration' && !isStandardUser ? (
              <AdministrationPanel
                client={adminClient ?? defaultAdministrationClient}
                currentUser={user}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {confirmDialog === 'leave' ? (
        <ConfirmDialog
          open={confirmDialog === 'leave'}
          title="Discard unsaved changes?"
          message="Discard unsaved configuration changes and return to chat?"
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          variant="warning"
          onConfirm={() => {
            setConfirmDialog(null);
            onBackToChat();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      ) : null}

      {confirmDialog === 'reload' ? (
        <ConfirmDialog
          open={confirmDialog === 'reload'}
          title="Discard unsaved changes?"
          message="Discard unsaved configuration changes and reload saved settings?"
          confirmLabel="Discard and reload"
          cancelLabel="Keep editing"
          variant="warning"
          onConfirm={() => {
            setConfirmDialog(null);
            performReload();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      ) : null}
    </div>
  );
}
