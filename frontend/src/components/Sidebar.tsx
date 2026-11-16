/**
 * ============================================================================
 * FILE: Sidebar.tsx
 * LOCATION: frontend/src/components/Sidebar.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible session sidebar with New chat and paginated history.
 *
 * ROLE IN PROJECT:
 *    Navigation surface for ChatView. Consumes chat context so session order
 *    from the reducer is rendered with current-page semantics and a mobile
 *    drawer open state.
 *
 * KEY COMPONENTS:
 *    - Brand / collapse control
 *    - New chat control, Search (command palette) entry
 *    - Flag-aware Workspace navigation (shellNavItems)
 *    - Date-grouped session list with aria-current
 *    - Load-more pagination trigger
 * ============================================================================
 */

import { memo, useState } from 'react';
import type { AuthUser } from '../api/auth-protocol.ts';
import type { ChatState } from '../features/chat/state/chat-types.ts';
import type { SessionSummary } from '../api/protocol.ts';
import { useChat } from '../features/chat/state/chat-context.tsx';
import { ProfileMenu } from '../features/admin-config/ProfileMenu.tsx';
import { shellNavItems } from '../app/navigation.ts';
import { BrandLockup } from './BrandMark.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { IconEdit, IconNewChat, IconPin, IconPlug, IconSearch, IconSettings, IconSidebar, IconTrash } from './icons.tsx';

import '../styles/shell.css';

const NAV_ICONS: Record<string, typeof IconPlug> = { integrations: IconPlug, settings: IconSettings };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function activityGroup(lastActivityAt: string, now: Date): string {
  const activity = Date.parse(lastActivityAt);
  if (!Number.isFinite(activity)) {
    return 'Chats';
  }

  const today = startOfDay(now);
  const day = 86_400_000;
  if (activity >= today) {
    return 'Today';
  }
  if (activity >= today - day) {
    return 'Yesterday';
  }
  if (activity >= today - 7 * day) {
    return 'Previous 7 days';
  }
  if (activity >= today - 30 * day) {
    return 'Previous 30 days';
  }
  return new Date(activity).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function groupSessions(sessions: SessionSummary[], now: Date): { label: string; sessions: SessionSummary[] }[] {
  const groups: { label: string; sessions: SessionSummary[] }[] = [];
  for (const session of sessions) {
    const label = session.pinned ? 'Pinned' : activityGroup(session.lastActivityAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) {
      last.sessions.push(session);
    } else {
      groups.push({ label, sessions: [session] });
    }
  }
  return groups;
}

export type SidebarProps = {
  onCollapse?: () => void;
  onNewChat?: () => void;
  onManageAurvin?: () => void;
  /** Opens Manage Aurvin → Plugins (Integrations). */
  onOpenIntegrations?: () => void;
  onOpenCommandPalette?: () => void;
  user?: AuthUser | null;
  onSignOut?: () => void;
};

export function Sidebar({ onCollapse, onNewChat, onManageAurvin, onOpenIntegrations, onOpenCommandPalette, user, onSignOut }: SidebarProps) {
  const { state, actions, dispatch, client } = useChat();
  const selectedTurnBusy =
    state.isStreaming ||
    state.isSubmitting ||
    state.turnStatus === 'accepted' ||
    state.turnStatus === 'generating' ||
    state.turnStatus === 'finalizing';
  return <SidebarContent onCollapse={onCollapse} onNewChat={onNewChat} onManageAurvin={onManageAurvin}
    onOpenIntegrations={onOpenIntegrations} onOpenCommandPalette={onOpenCommandPalette}
    user={user} onSignOut={onSignOut}
    actions={actions} dispatch={dispatch} client={client} sessions={state.sessions}
    sidebarOpen={state.sidebarOpen} sessionsError={state.sessionsError}
    activeSessionId={state.activeSessionId} selectedTurnBusy={selectedTurnBusy}
    hasMoreSessions={state.hasMoreSessions}
    sessionsLoading={state.sessionsLoading} />;
}

const SidebarContent = memo(function SidebarContent({ onCollapse, onNewChat, onManageAurvin,
  onOpenIntegrations, onOpenCommandPalette, user, onSignOut,
  actions, dispatch, client, ...state }: SidebarProps &
  Pick<ReturnType<typeof useChat>, 'actions' | 'dispatch' | 'client'> &
  Pick<ChatState, 'sessions' | 'sidebarOpen' | 'sessionsError' | 'activeSessionId' |
    'hasMoreSessions' | 'sessionsLoading'> &
  { selectedTurnBusy: boolean }) {
  const [now] = useState(() => new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<SessionSummary | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const groups = groupSessions(state.sessions, now);
  const navItems = shellNavItems({ onManageAurvin, onOpenIntegrations }, user?.role);

  const updateSession = async (session: SessionSummary, changes: { title?: string; pinned?: boolean }) => {
    setBusy(session.sessionId);
    setError(null);
    try {
      const updated = await client.updateSession(session.sessionId, changes);
      dispatch({ type: 'SESSION_UPDATED', payload: updated });
      setRenaming(null);
      await actions.loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update session.');
    } finally { setBusy(null); }
  };

  const confirmDeleteSession = async () => {
    if (!sessionToDelete) return;
    const target = sessionToDelete;
    setBusy(target.sessionId);
    setError(null);
    try {
      await client.deleteSession(target.sessionId);
      dispatch({ type: 'SESSION_DELETED', payload: target.sessionId });
      setSessionToDelete(null);
      await actions.loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete session.');
    } finally { setBusy(null); }
  };

  return (
    <aside
      className="aurvin-sidebar"
      data-open={state.sidebarOpen}
      role="complementary"
      aria-label="Chat history"
    >
      <div className="aurvin-sidebar-top">
        <span className="aurvin-brand">
          <BrandLockup size={28} />
        </span>
        <button
          type="button"
          className="aurvin-chat-icon-btn"
          onClick={() => {
            onCollapse?.();
            dispatch({ type: 'CLOSE_SIDEBAR' });
          }}
          aria-label="Close sidebar"
        >
          <IconSidebar />
        </button>
      </div>

      <div className="aurvin-sidebar-header">
        <button
          type="button"
          className="aurvin-new-chat-btn"
          onClick={onNewChat ?? actions.startNewChat}
          aria-label="Start a new chat"
        >
          <IconNewChat size={18} />
          New chat
        </button>
        {onOpenCommandPalette ? (
          <button
            type="button"
            className="aurvin-sidebar-link"
            onClick={onOpenCommandPalette}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <IconSearch />
            <span>Search</span>
            <kbd className="aurvin-sidebar-shortcut" aria-hidden="true">Ctrl K</kbd>
          </button>
        ) : null}
      </div>

      {navItems.length > 0 ? (
        <nav className="aurvin-primary-nav" aria-label="Workspace">
          <ul>
            {navItems.map((item) => {
              const Icon = NAV_ICONS[item.id];
              return (
                <li key={item.id}>
                  <button type="button" className="aurvin-sidebar-link" onClick={item.onSelect}>
                    {Icon ? <Icon /> : null}
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <nav className="aurvin-session-nav" aria-label="Sessions">
        {error || state.sessionsError ? <p className="aurvin-session-error" role="alert">{error || state.sessionsError}</p> : null}
        {groups.map((group) => (
          <section key={group.label} className="aurvin-session-group">
            <h2 className="aurvin-session-group-label">{group.label}</h2>
            <ul className="aurvin-session-list">
              {group.sessions.map((session) => {
                const isSelected = session.sessionId === state.activeSessionId;
                const title = session.title || 'Untitled Chat';
                return (
                  <li key={session.sessionId} className="aurvin-session-row" data-selected={isSelected || undefined}>
                    <button
                      type="button"
                      className="aurvin-session-item"
                      aria-current={isSelected ? 'page' : undefined}
                      title={title}
                      onClick={() => {
                        void actions.selectSession(session.sessionId, session.title);
                      }}
                    >
                      <div className="aurvin-session-title">{title}</div>
                    </button>
                    <details className="aurvin-session-options" onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector('summary')?.focus();
                      }
                    }} onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                    }}>
                      <summary aria-label={`Options for ${title}`} title="Session options">•••</summary>
                      <div className="aurvin-session-menu" onClick={(event) => {
                        const details = event.currentTarget.closest('details');
                        if (details) details.open = false;
                      }}>
                        <button type="button" disabled={busy !== null} onClick={() => {
                          setRenaming(session); setTitleInput(title); setError(null);
                        }}><IconEdit size={16} />Rename</button>
                        <button type="button" disabled={busy !== null || (isSelected && state.selectedTurnBusy)}
                          onClick={() => { setSessionToDelete(session); }}><IconTrash size={16} />Delete</button>
                        <button type="button" disabled={busy !== null} onClick={() => {
                          void updateSession(session, { pinned: !session.pinned });
                        }}><IconPin size={16} />{session.pinned ? 'Unpin' : 'Pin'}</button>
                      </div>
                    </details>
                    {renaming?.sessionId === session.sessionId ? (
                      <form className="aurvin-session-rename" onSubmit={(event) => {
                        event.preventDefault();
                        void updateSession(session, { title: titleInput.trim() });
                      }}>
                        <input aria-label="Session name" value={titleInput} maxLength={80} required
                          onChange={(event) => setTitleInput(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} />
                        <button type="submit" disabled={busy !== null || !titleInput.trim()}>Save</button>
                        <button type="button" disabled={busy !== null} onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {state.hasMoreSessions ? (
          <button
            type="button"
            className="aurvin-quiet-btn"
            onClick={() => {
              void actions.loadMoreSessions();
            }}
            disabled={state.sessionsLoading}
          >
            Load more chats…
          </button>
        ) : null}
      </nav>
      {onManageAurvin ? (
        <div className="aurvin-profile-footer">
          <ProfileMenu user={user} onManageAurvin={onManageAurvin} onSignOut={onSignOut} />
        </div>
      ) : null}

      {sessionToDelete ? (
        <ConfirmDialog
          open={Boolean(sessionToDelete)}
          title="Delete chat?"
          message={`Delete “${sessionToDelete.title || 'Untitled Chat'}”? This chat will be removed from your history.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          busy={busy === sessionToDelete.sessionId}
          busyLabel="Deleting…"
          onConfirm={confirmDeleteSession}
          onCancel={() => {
            if (busy === null) setSessionToDelete(null);
          }}
        />
      ) : null}
    </aside>
  );
});
