/**
 * ============================================================================
 * FILE: App.tsx
 * LOCATION: frontend/src/App.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Mount top-level authentication provider, authenticated ChatProvider shell,
 *    and role-aware navigation.
 *
 * ROLE IN PROJECT:
 *    Switches between unauthenticated auth screens and the authenticated
 *    ChatView shell. Ensures private client state teardown on account change.
 *
 * KEY COMPONENTS:
 *    - App: ThemeProvider + AuthProvider wrapper.
 *    - AppShell: Route and auth status router.
 *    - VoiceChatShell: Live voice and chat connection.
 * ============================================================================
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { createAdminConfigClient, type AdminConfigClient } from './api/admin-config-client.ts'
import { createAdministrationClient, type AdministrationClient } from './api/administration-client.ts'
import type { AuthClient } from './api/auth-client.ts'
import type { AuthUser } from './api/auth-protocol.ts'
import { createCalendarClient, type CalendarClient } from './api/calendar-client.ts'
import {
  extractAndScrubCalendarOAuthCallback,
  type CalendarOAuthCallbackOutcome,
} from './api/calendar-protocol.ts'
import { clearAllSubmissionRecovery } from './api/client.ts'
import { AdminDashboard, type DashboardSection } from './features/admin-config/AdminDashboard.tsx'
import {
  AuthProvider,
  ForgotPasswordForm,
  LoginForm,
  MandatoryPasswordChangeForm,
  ResetPasswordForm,
  useAuth,
  type AuthStatus,
} from './features/auth/index.ts'
import { ChatProvider, ChatView, type ApiClient } from './features/chat/index.ts'
import { useChat } from './features/chat/state/chat-context.tsx'
import type { VoiceSaveSnapshot } from './api/voice-protocol.ts'
import { refreshVoiceCapabilities } from './features/voice/index.ts'
import { useLiveVoice } from './features/voice/state/useLiveVoice.ts'
import { ThemeProvider } from './app/theme/ThemeProvider.tsx'
import './App.css'

export function bindLiveConversation(
  actions: {
    bindVoiceConversation?: (
      token: string,
      conversationId: string,
      meta?: { turnId: string; save: VoiceSaveSnapshot },
    ) => boolean
  } | Record<string, unknown>,
  token: string,
  conversationId: string,
  meta?: { turnId: string; save: VoiceSaveSnapshot },
) {
  const fn = (actions as {
    bindVoiceConversation?: (
      token: string,
      conversationId: string,
      meta?: { turnId: string; save: VoiceSaveSnapshot },
    ) => boolean
  }).bindVoiceConversation
  return (meta ? fn?.(token, conversationId, meta) : fn?.(token, conversationId)) ?? false
}

export function registerVoiceStart(ref: { current: (() => void) | null }, start: () => void) {
  ref.current = start
  return () => { if (ref.current === start) ref.current = null }
}

function readInitialOAuthCallback(): CalendarOAuthCallbackOutcome | null {
  if (typeof window === 'undefined') return null
  const result = extractAndScrubCalendarOAuthCallback(window.location.href)
  if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', result.scrubbedPathAndSearch)
  }
  return result.outcome
}

function readInitialResetToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('token')
  } catch {
    return null
  }
}

function VoiceChatShell({
  user,
  onSignOut,
  startRef,
  adminClient,
  calendarClient,
  administrationClient,
  refreshCapabilities,
}: {
  user: AuthUser
  onSignOut: () => void
  startRef: MutableRefObject<(() => void) | null>
  adminClient: AdminConfigClient
  calendarClient: CalendarClient
  administrationClient: AdministrationClient
  refreshCapabilities: () => Promise<boolean>
}) {
  const { state, actions, dispatch } = useChat()
  const [oauthOutcome, setOauthOutcome] = useState<CalendarOAuthCallbackOutcome | null>(() =>
    readInitialOAuthCallback(),
  )
  const [page, setPage] = useState<'chat' | 'admin'>(() =>
    oauthOutcome !== null ? 'admin' : 'chat',
  )
  const [adminSection, setAdminSection] = useState<DashboardSection>(() =>
    oauthOutcome !== null ? 'calendar' : (user.role === 'user' ? 'calendar' : 'openrouter'),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const result = extractAndScrubCalendarOAuthCallback(window.location.href)
    if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
      window.history.replaceState(null, '', result.scrubbedPathAndSearch)
    }
    if (result.outcome !== null) {
      setOauthOutcome(result.outcome)
      setAdminSection('calendar')
      setPage('admin')
    }
  }, [])

  const voice = useLiveVoice({
    conversationId: state.activeSessionId,
    draft: state.draftInput,
    bindings: {
      claimVoiceInput: (mode, onClose) => actions.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => actions.writeVoiceDraft(token, text),
      releaseVoiceInput: (token) => actions.releaseVoiceInput(token),
      bindVoiceConversation: (token, id, meta) =>
        meta ? bindLiveConversation(actions, token, id, meta) : bindLiveConversation(actions, token, id),
      refreshSessions: (
        conversationId?: string,
        voiceSession?: { voiceSessionId: string; durationSeconds: number; startedAt: string },
      ) => {
        void actions.loadSessions()
        const target = conversationId || state.activeSessionId
        if (target && voiceSession) {
          actions.commitVoiceSession({
            sessionId: target,
            voiceSessionId: voiceSession.voiceSessionId,
            durationSeconds: voiceSession.durationSeconds,
            createdAt: voiceSession.startedAt,
          })
        }
        if (target) {
          void actions.reloadMessages(target)
        }
      },
      openCanvasArtifact: (artifactId) =>
        dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } }),
      getActiveConversationId: () => state.activeSessionId,
    },
  })
  useLayoutEffect(() => registerVoiceStart(startRef, voice.start), [startRef, voice.start])
  const chatActive = state.isStreaming || state.isSubmitting || state.voiceInput !== null
  return (
    <>
      <div className="aurvin-chat-surface" hidden={page !== 'chat'} inert={page !== 'chat'}>
        <ChatView
          liveVoice={voice}
          visible={page === 'chat'}
          user={user}
          onSignOut={onSignOut}
          onManageAurvin={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection(user.role === 'user' ? 'calendar' : 'openrouter')
            setPage('admin')
          }}
          onOpenCalendarSetup={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection('calendar')
            setPage('admin')
          }}
        />
      </div>
      {page === 'admin' ? (
        <AdminDashboard
          client={adminClient}
          calendarClient={calendarClient}
          adminClient={administrationClient}
          user={user}
          initialSection={adminSection}
          oauthOutcome={oauthOutcome}
          onDismissOAuthOutcome={() => setOauthOutcome(null)}
          refreshCapabilities={refreshCapabilities}
          chatActive={chatActive}
          onBackToChat={() => setPage('chat')}
        />
      ) : null}
    </>
  )
}

function AppShell({
  client,
  adminClient,
  calendarClient,
  administrationClient,
  refreshCapabilities,
}: {
  client?: ApiClient
  adminClient?: AdminConfigClient
  calendarClient?: CalendarClient
  administrationClient?: AdministrationClient
  refreshCapabilities?: () => Promise<boolean>
}) {
  const auth = useAuth()
  const [resetToken, setResetToken] = useState<string | null>(() => readInitialResetToken())
  const [showForgot, setShowForgot] = useState(false)
  const startRef = useRef<(() => void) | null>(null)
  const startVoiceConversation = useCallback(() => { startRef.current?.() }, [])
  const [defaultAdminClient] = useState(() => createAdminConfigClient())
  const [defaultCalendarClient] = useState(() => createCalendarClient())
  const [defaultAdministrationClient] = useState(() => createAdministrationClient())

  const handleSignOut = useCallback(() => {
    clearAllSubmissionRecovery()
    void auth.logout()
  }, [auth])

  if (resetToken) {
    return (
      <ResetPasswordForm
        token={resetToken}
        onSubmit={async (req) => {
          await auth.client.resetPassword(req)
          setResetToken(null)
          if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
            window.history.replaceState(null, '', window.location.pathname)
          }
        }}
        error={auth.error}
      />
    )
  }

  if (auth.status === 'loading') {
    return <div className="aurvin-auth-loading">Loading Aurvin…</div>
  }

  if (auth.status === 'unauthenticated') {
    if (showForgot) {
      return (
        <ForgotPasswordForm
          onSubmit={async (req) => {
            await auth.client.forgotPassword(req)
          }}
          onBackToLogin={() => setShowForgot(false)}
          error={auth.error}
        />
      )
    }
    return (
      <LoginForm
        onSubmit={async (credentials) => {
          await auth.login(credentials)
        }}
        onForgotPassword={() => setShowForgot(true)}
        error={auth.error}
      />
    )
  }

  if (auth.status === 'password-change-required' || auth.user?.passwordChangeRequired) {
    return (
      <MandatoryPasswordChangeForm
        onSubmit={async (req) => {
          await auth.changePassword(req)
        }}
        onSignOut={handleSignOut}
        error={auth.error}
      />
    )
  }

  if (!auth.user) {
    return <div className="aurvin-auth-loading">Loading Aurvin…</div>
  }

  return (
    <ChatProvider
      key={auth.user.userId}
      client={client}
      startVoiceConversation={startVoiceConversation}
    >
      <VoiceChatShell
        user={auth.user}
        onSignOut={handleSignOut}
        startRef={startRef}
        adminClient={adminClient ?? defaultAdminClient}
        calendarClient={calendarClient ?? defaultCalendarClient}
        administrationClient={administrationClient ?? defaultAdministrationClient}
        refreshCapabilities={refreshCapabilities ?? refreshVoiceCapabilities}
      />
    </ChatProvider>
  )
}

export type AppProps = {
  client?: ApiClient
  adminClient?: AdminConfigClient
  calendarClient?: CalendarClient
  administrationClient?: AdministrationClient
  authClient?: AuthClient
  initialAuthUser?: AuthUser | null
  initialAuthStatus?: AuthStatus
  refreshCapabilities?: () => Promise<boolean>
}

function App({
  client,
  adminClient,
  calendarClient,
  administrationClient,
  authClient,
  initialAuthUser,
  initialAuthStatus,
  refreshCapabilities,
}: AppProps) {
  return (
    <ThemeProvider>
      <AuthProvider
        client={authClient}
        initialUser={initialAuthUser}
        initialStatus={initialAuthStatus}
      >
        <AppShell
          client={client}
          adminClient={adminClient}
          calendarClient={calendarClient}
          administrationClient={administrationClient}
          refreshCapabilities={refreshCapabilities}
        />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
