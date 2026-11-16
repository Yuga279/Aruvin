/**
 * ============================================================================
 * FILE: fixture-api.ts
 * LOCATION: frontend/src/features/auth/integration-tests/fixture-api.ts
 * ============================================================================
 * PURPOSE:
 *    Deterministic closed API and fetch fixture for auth integration checks.
 * ROLE IN PROJECT:
 *    Simulates backend auth, administration, chat, voice, and calendar endpoints
 *    for browser DOM verification without real network access.
 * KEY COMPONENTS:
 *    - createFixtureApi: Returns fetch double, request tracking, and test controls.
 *    - Accounts and state: Admin, User A (temporary password), and User B.
 * ============================================================================
 */

import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO } from '../../../api/voice-protocol.ts'
import { publicConfig } from '../../admin-config/testing/fixtures.ts'
import type { AuthUser } from '../../../api/auth-protocol.ts'
import type { AdministrationUser } from '../../../api/administration-protocol.ts'

export type FixtureAccount = AuthUser & {
  status: 'active' | 'inactive'
  createdAt: string
  password: string
}

export type FixtureSession = {
  sessionId: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type FixtureMessage = {
  messageId: string
  sessionId: string
  userId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export function createFixtureApi() {
  const unexpected: string[] = []
  const requests: { method: string; path: string; owner: string | null }[] = []

  // Seeded fixture accounts
  const accounts = new Map<string, FixtureAccount>([
    [
      'admin',
      {
        userId: 'admin',
        email: 'admin@example.test',
        role: 'super-admin',
        passwordChangeRequired: false,
        status: 'active',
        createdAt: '2026-11-10T00:00:00.000Z',
        password: 'fixture-password-123',
      },
    ],
    [
      'a',
      {
        userId: 'a',
        email: 'a@example.test',
        role: 'user',
        passwordChangeRequired: true,
        status: 'active',
        createdAt: '2026-11-10T01:00:00.000Z',
        password: 'fixture-password-123',
      },
    ],
    [
      'b',
      {
        userId: 'b',
        email: 'b@example.test',
        role: 'user',
        passwordChangeRequired: false,
        status: 'active',
        createdAt: '2026-11-10T02:00:00.000Z',
        password: 'fixture-password-123',
      },
    ],
  ])

  let currentAccount: FixtureAccount | null = null
  let currentAdminConfig = publicConfig()
  let validResetToken: string | null = 'valid-reset-token'
  let passwordTimeout = false
  let userConfigRequestCount = 0
  let adminConfigRequestCount = 0
  let logoutCount = 0
  let unauthorizedOnNextRequest = false
  let createdUserCount = 0

  // Seeded per-owner sessions and messages
  const sessions = new Map<string, FixtureSession>([
    [
      's_admin',
      {
        sessionId: 's_admin',
        userId: 'admin',
        title: 'Admin Session 1',
        createdAt: '2026-11-10T00:10:00.000Z',
        updatedAt: '2026-11-10T00:10:00.000Z',
      },
    ],
    [
      's_a',
      {
        sessionId: 's_a',
        userId: 'a',
        title: 'User A Session 1',
        createdAt: '2026-11-10T01:10:00.000Z',
        updatedAt: '2026-11-10T01:10:00.000Z',
      },
    ],
    [
      's_b',
      {
        sessionId: 's_b',
        userId: 'b',
        title: 'User B Session 1',
        createdAt: '2026-11-10T02:10:00.000Z',
        updatedAt: '2026-11-10T02:10:00.000Z',
      },
    ],
  ])

  const messages = new Map<string, FixtureMessage[]>([
    [
      's_admin',
      [
        {
          messageId: 'm_admin_1',
          sessionId: 's_admin',
          userId: 'admin',
          role: 'user',
          content: 'Hello from admin',
          createdAt: '2026-11-10T00:10:01.000Z',
        },
      ],
    ],
    [
      's_a',
      [
        {
          messageId: 'm_a_1',
          sessionId: 's_a',
          userId: 'a',
          role: 'user',
          content: 'Hello from user A',
          createdAt: '2026-11-10T01:10:01.000Z',
        },
      ],
    ],
    [
      's_b',
      [
        {
          messageId: 'm_b_1',
          sessionId: 's_b',
          userId: 'b',
          role: 'user',
          content: 'Hello from user B',
          createdAt: '2026-11-10T02:10:01.000Z',
        },
      ],
    ],
  ])

  function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...headers,
      },
    })
  }

  function refuse(method: string, url: URL): never {
    const key = `${method} ${url.href}`
    unexpected.push(key)
    throw new Error(`Unexpected fixture request: ${key}`)
  }

  const controls = {
    get currentAccount() {
      return currentAccount
    },
    setCurrentAccount(account: FixtureAccount | null) {
      currentAccount = account
    },
    loginAs(userId: 'admin' | 'a' | 'b') {
      const acct = accounts.get(userId)
      if (acct) currentAccount = acct
    },
    setPasswordTimeout(value: boolean) {
      passwordTimeout = value
    },
    setValidResetToken(token: string | null) {
      validResetToken = token
    },
    setUnauthorizedOnNextRequest(value: boolean) {
      unauthorizedOnNextRequest = value
    },
    get userConfigRequestCount() {
      return userConfigRequestCount
    },
    get adminConfigRequestCount() {
      return adminConfigRequestCount
    },
    get logoutCount() {
      return logoutCount
    },
    get accounts() {
      return accounts
    },
    get sessions() {
      return sessions
    },
    get messages() {
      return messages
    },
  }

  const customFetch: typeof globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url: URL
    try {
      url = new URL(rawUrl, 'http://127.0.0.1:5173')
    } catch {
      throw new Error(`Malformed fixture URL: ${rawUrl}`)
    }

    if (url.origin !== 'http://127.0.0.1:5173') {
      const method = init?.method?.toUpperCase() || (typeof input === 'object' && 'method' in input ? (input.method as string).toUpperCase() : 'GET')
      refuse(method, url)
    }

    const method = (init?.method?.toUpperCase() || (typeof input === 'object' && 'method' in input ? (input.method as string).toUpperCase() : 'GET'))
    const path = url.pathname

    requests.push({ method, path, owner: currentAccount?.userId ?? null })

    // Simulate genuine 401 if requested by controls
    if (unauthorizedOnNextRequest && path !== '/api/auth/login' && path !== '/api/auth/me') {
      unauthorizedOnNextRequest = false
      currentAccount = null
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Session expired' } }, 401)
    }

    // --- Auth Endpoints ---
    if (method === 'GET' && path === '/api/auth/me') {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, 401)
      }
      return json({
        user: {
          userId: currentAccount.userId,
          email: currentAccount.email,
          role: currentAccount.role,
          passwordChangeRequired: currentAccount.passwordChangeRequired,
        },
      })
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = body.password

      let matched: FixtureAccount | undefined
      for (const acct of accounts.values()) {
        if (acct.email.toLowerCase() === email) {
          matched = acct
          break
        }
      }

      if (!matched || matched.password !== password) {
        return json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }, 401)
      }

      if (matched.status !== 'active') {
        return json({ error: { code: 'FORBIDDEN', message: 'Account is deactivated' } }, 403)
      }

      currentAccount = matched
      return json({
        user: {
          userId: matched.userId,
          email: matched.email,
          role: matched.role,
          passwordChangeRequired: matched.passwordChangeRequired,
        },
      })
    }

    if (method === 'POST' && path === '/api/auth/password') {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      if (passwordTimeout) {
        return json({ error: { code: 'AUTH_TIMEOUT', message: 'Password change timed out' } }, 504)
      }

      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const currentPassword = body.currentPassword
      const newPassword = body.newPassword

      if (currentPassword === newPassword) {
        return json({ error: { code: 'INVALID_PASSWORD', message: 'New password must be different from current password' } }, 400)
      }

      currentAccount.password = newPassword
      currentAccount.passwordChangeRequired = false
      return json({
        user: {
          userId: currentAccount.userId,
          email: currentAccount.email,
          role: currentAccount.role,
          passwordChangeRequired: false,
        },
      })
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      logoutCount++
      currentAccount = null
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }

    if (method === 'POST' && path === '/api/auth/forgot-password') {
      // Known and unknown return identical response
      return json({ ok: true })
    }

    if (method === 'POST' && path === '/api/auth/reset-password') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const token = body.token
      if (!token || token !== validResetToken) {
        return json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset token' } }, 400)
      }
      // Single-use token accepted once, then invalidated
      validResetToken = null
      return json({ ok: true })
    }

    // --- Voice Config ---
    if (method === 'GET' && path === '/api/voice/config') {
      return json({
        protocolVersion: 1,
        enabledModes: { dictation: false, live: false },
        supportedLocales: ['en-US'],
        limits: { ...DEFAULT_VOICE_LIMITS },
        inputAudio: { ...INPUT_AUDIO },
        outputAudio: { ...OUTPUT_AUDIO },
      })
    }

    // --- Admin Config Endpoints ---
    if (path.startsWith('/api/admin/config')) {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      if (currentAccount.role !== 'super-admin') {
        userConfigRequestCount++
        refuse(method, url)
      }
      adminConfigRequestCount++
      if (method === 'GET') {
        return json(currentAdminConfig)
      }
      if (method === 'PUT') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        currentAdminConfig = {
          ...currentAdminConfig,
          ...body,
          revision: currentAdminConfig.revision + 1,
          activeRevision: currentAdminConfig.revision + 1,
        }
        return json(currentAdminConfig)
      }
    }

    // --- Administration Users Endpoints ---
    if (path === '/api/admin/users') {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      if (currentAccount.role !== 'super-admin') {
        return json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } }, 403)
      }

      if (method === 'GET') {
        const items: AdministrationUser[] = [...accounts.values()].map((a) => ({
          userId: a.userId,
          email: a.email,
          role: a.role,
          status: a.status,
          passwordChangeRequired: a.passwordChangeRequired,
          createdAt: a.createdAt,
        }))
        return json({ items, nextCursor: null })
      }

      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        if (body.role !== 'user') {
          return json({ error: { code: 'INVALID_ROLE', retryable: false } }, 400)
        }
        for (const existing of accounts.values()) {
          if (existing.email.toLowerCase() === email) {
            return json({ error: { code: 'ACCOUNT_CONFLICT', retryable: false } }, 409)
          }
        }
        const newId = `user_${++createdUserCount}`
        const newUser: FixtureAccount = {
          userId: newId,
          email,
          role: 'user',
          status: 'active',
          passwordChangeRequired: true,
          createdAt: new Date().toISOString(),
          password: body.temporaryPassword || 'temp-pass-123',
        }
        accounts.set(newId, newUser)
        return json({
          user: {
            userId: newUser.userId,
            email: newUser.email,
            role: newUser.role,
            status: newUser.status,
            passwordChangeRequired: newUser.passwordChangeRequired,
            createdAt: newUser.createdAt,
          },
        }, 201)
      }
    }

    const deactivateMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/deactivate$/)
    if (method === 'POST' && deactivateMatch) {
      if (!currentAccount || currentAccount.role !== 'super-admin') {
        return json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } }, 403)
      }
      const targetId = decodeURIComponent(deactivateMatch[1]!)
      const target = accounts.get(targetId)
      if (!target) return json({ error: { code: 'ACCOUNT_NOT_FOUND', retryable: false } }, 404)
      target.status = 'inactive'
      return json({
        user: {
          userId: target.userId,
          email: target.email,
          role: target.role,
          status: target.status,
          passwordChangeRequired: target.passwordChangeRequired,
          createdAt: target.createdAt,
        },
      })
    }

    const reactivateMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reactivate$/)
    if (method === 'POST' && reactivateMatch) {
      if (!currentAccount || currentAccount.role !== 'super-admin') {
        return json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } }, 403)
      }
      const targetId = decodeURIComponent(reactivateMatch[1]!)
      const target = accounts.get(targetId)
      if (!target) return json({ error: { code: 'ACCOUNT_NOT_FOUND', retryable: false } }, 404)
      target.status = 'active'
      return json({
        user: {
          userId: target.userId,
          email: target.email,
          role: target.role,
          status: target.status,
          passwordChangeRequired: target.passwordChangeRequired,
          createdAt: target.createdAt,
        },
      })
    }

    const resetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password-reset$/)
    if (method === 'POST' && resetMatch) {
      if (!currentAccount || currentAccount.role !== 'super-admin') {
        return json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } }, 403)
      }
      const targetId = decodeURIComponent(resetMatch[1]!)
      const target = accounts.get(targetId)
      if (!target) return json({ error: { code: 'ACCOUNT_NOT_FOUND', retryable: false } }, 404)
      return json({ ok: true })
    }

    // --- Google Calendar Endpoints ---
    if (path.startsWith('/api/plugins/google-calendar/')) {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      if (path === '/api/plugins/google-calendar/status') {
        return json({
          connectionState: 'disabled',
          accountLabel: `${currentAccount.userId}-calendar@example.test`,
          requiresConsent: false,
          calendarCount: 0,
        })
      }
      if (path === '/api/plugins/google-calendar/settings') {
        return json({
          defaultCalendarId: null,
          enabled: false,
        })
      }
      if (path === '/api/plugins/google-calendar/calendars') {
        return json({ calendars: [], nextCursor: null })
      }
      if (path === '/api/plugins/google-calendar/disconnect') {
        return json({ ok: true })
      }
    }

    // --- Sessions / Chat Endpoints ---
    if (path === '/api/sessions') {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      if (currentAccount.passwordChangeRequired) {
        return json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required' } }, 403)
      }
      if (method === 'GET') {
        const ownerSessions = [...sessions.values()].filter((s) => s.userId === currentAccount!.userId)
        return json({ items: ownerSessions, nextCursor: null })
      }
      if (method === 'POST') {
        const newSessionId = `s_${Date.now()}`
        const newSession: FixtureSession = {
          sessionId: newSessionId,
          userId: currentAccount.userId,
          title: 'New Session',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        sessions.set(newSessionId, newSession)
        messages.set(newSessionId, [])
        return json(newSession, 201)
      }
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch) {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      const sessionId = decodeURIComponent(sessionMatch[1]!)
      const session = sessions.get(sessionId)
      if (!session || session.userId !== currentAccount.userId) {
        return json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
      }
      if (method === 'GET') return json(session)
      if (method === 'DELETE') {
        sessions.delete(sessionId)
        messages.delete(sessionId)
        return new Response(null, { status: 204 })
      }
      if (method === 'PATCH') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        if (body.title) session.title = body.title
        return json(session)
      }
    }

    const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/)
    if (messagesMatch) {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      const sessionId = decodeURIComponent(messagesMatch[1]!)
      const session = sessions.get(sessionId)
      if (!session || session.userId !== currentAccount.userId) {
        return json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
      }
      if (method === 'GET') {
        const msgs = messages.get(sessionId) ?? []
        return json({ items: msgs, nextCursor: null })
      }
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        const text = typeof body.content === 'string' ? body.content : ''
        const turnId = `turn_${Date.now()}`
        const msgs = messages.get(sessionId) ?? []
        msgs.push({
          messageId: `msg_${Date.now()}`,
          sessionId,
          userId: currentAccount.userId,
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
        })
        messages.set(sessionId, msgs)
        return json(
          {
            turnId,
            sessionId,
            streamPath: `/api/sessions/${encodeURIComponent(sessionId)}/stream/${encodeURIComponent(turnId)}`,
          },
          202,
        )
      }
    }

    const streamMatch = path.match(/^\/api\/sessions\/([^/]+)\/stream\/([^/]+)$/)
    if (streamMatch && method === 'GET') {
      if (!currentAccount) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
      }
      const sessionId = decodeURIComponent(streamMatch[1]!)
      const session = sessions.get(sessionId)
      if (!session || session.userId !== currentAccount.userId) {
        return json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
      }
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          const chunk = encoder.encode(
            `event: message\ndata: ${JSON.stringify({ type: 'delta', delta: 'Hello from Aurvin fixture' })}\n\n` +
            `event: message\ndata: ${JSON.stringify({ type: 'terminal', status: 'completed' })}\n\n`,
          )
          controller.enqueue(chunk)
          controller.close()
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Any other unhandled endpoint
    refuse(method, url)
  }

  return {
    fetch: customFetch,
    unexpected,
    requests,
    controls,
  }
}
