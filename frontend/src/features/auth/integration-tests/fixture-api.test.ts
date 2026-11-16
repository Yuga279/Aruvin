/**
 * ============================================================================
 * FILE: fixture-api.test.ts
 * LOCATION: frontend/src/features/auth/integration-tests/fixture-api.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify closed browser fixture routing.
 * ROLE IN PROJECT:
 *    Distinguishes fixture integrity from application authorization.
 *    Proves refusal, session ownership, and counters without a real network.
 * KEY COMPONENTS:
 *    - Network refusal, session ownership, and deterministic endpoint routing.
 * ============================================================================
 */
import { expect, it } from 'vitest'
import { createFixtureApi } from './fixture-api.ts'

it('refuses unexpected external requests without invoking a real network', async () => {
  const f = createFixtureApi()
  await expect(f.fetch('https://outside.invalid/api/auth/me')).rejects.toThrow('Unexpected fixture request')
  expect(f.unexpected).toEqual(['GET https://outside.invalid/api/auth/me'])
})

it('handles /api/auth/me unauthenticated initially, and authenticated after login', async () => {
  const f = createFixtureApi()
  const unauth = await f.fetch('/api/auth/me')
  expect(unauth.status).toBe(401)
  expect(await unauth.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })

  const loginRes = await f.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'fixture-password-123' }),
  })
  expect(loginRes.status).toBe(200)
  const loginData = await loginRes.json()
  expect(loginData.user).toMatchObject({ userId: 'admin', role: 'super-admin', passwordChangeRequired: false })

  const me = await f.fetch('/api/auth/me')
  expect(me.status).toBe(200)
  expect((await me.json()).user).toMatchObject({ userId: 'admin', role: 'super-admin' })
})

it('authenticates all three accounts: admin, user A (pending onboarding), and user B', async () => {
  const f = createFixtureApi()

  // User A: passwordChangeRequired true
  const resA = await f.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'a@example.test', password: 'fixture-password-123' }),
  })
  expect((await resA.json()).user).toMatchObject({ userId: 'a', role: 'user', passwordChangeRequired: true })

  // Logout
  const logoutRes = await f.fetch('/api/auth/logout', { method: 'POST' })
  expect(logoutRes.status).toBe(204)
  expect(f.controls.logoutCount).toBe(1)

  // User B: passwordChangeRequired false
  const resB = await f.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'b@example.test', password: 'fixture-password-123' }),
  })
  expect((await resB.json()).user).toMatchObject({ userId: 'b', role: 'user', passwordChangeRequired: false })

  // Invalid password
  const resBad = await f.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'b@example.test', password: 'wrong-password' }),
  })
  expect(resBad.status).toBe(401)
})

it('supports password change, enforcing different password and clearing onboarding', async () => {
  const f = createFixtureApi()
  f.controls.loginAs('a')

  // Equal password rejected
  const resEqual = await f.fetch('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'fixture-password-123', newPassword: 'fixture-password-123' }),
  })
  expect(resEqual.status).toBe(400)
  expect((await resEqual.json()).error.code).toBe('INVALID_PASSWORD')

  // Timeout if simulated
  f.controls.setPasswordTimeout(true)
  const resTimeout = await f.fetch('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'fixture-password-123', newPassword: 'new-pass-456' }),
  })
  expect(resTimeout.status).toBe(504)
  expect((await resTimeout.json()).error.code).toBe('AUTH_TIMEOUT')
  f.controls.setPasswordTimeout(false)

  // Success
  const resOk = await f.fetch('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'fixture-password-123', newPassword: 'new-pass-456' }),
  })
  expect(resOk.status).toBe(200)
  expect((await resOk.json()).user.passwordChangeRequired).toBe(false)
})

it('handles forgot password and single-use reset password token replay rejection', async () => {
  const f = createFixtureApi()

  // Forgot password
  const forgot = await f.fetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'anyone@example.test' }),
  })
  expect(forgot.status).toBe(200)
  expect(await forgot.json()).toEqual({ ok: true })

  // Reset password with valid token
  const reset1 = await f.fetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: 'valid-reset-token', newPassword: 'brand-new-pass' }),
  })
  expect(reset1.status).toBe(200)
  expect(await reset1.json()).toEqual({ ok: true })

  // Replay of same token rejected
  const reset2 = await f.fetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: 'valid-reset-token', newPassword: 'another-pass' }),
  })
  expect(reset2.status).toBe(400)
  expect((await reset2.json()).error.code).toBe('INVALID_TOKEN')
})

it('isolates sessions and messages across owner switch', async () => {
  const f = createFixtureApi()

  // Admin sessions
  f.controls.loginAs('admin')
  const adminSessionsRes = await f.fetch('/api/sessions')
  const adminSessions = (await adminSessionsRes.json()).items
  expect(adminSessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['s_admin'])

  // Admin cannot read user A session
  const adminReadA = await f.fetch('/api/sessions/s_a')
  expect(adminReadA.status).toBe(404)

  // Switch to User B
  f.controls.loginAs('b')
  const bSessionsRes = await f.fetch('/api/sessions')
  const bSessions = (await bSessionsRes.json()).items
  expect(bSessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['s_b'])

  // User B messages
  const bMessagesRes = await f.fetch('/api/sessions/s_b/messages')
  expect(bMessagesRes.status).toBe(200)
  const bMessages = (await bMessagesRes.json()).items
  expect(bMessages[0].content).toBe('Hello from user B')
})

it('tracks and refuses user config requests while allowing admin config', async () => {
  const f = createFixtureApi()

  // User B config attempt fails and increments counter
  f.controls.loginAs('b')
  await expect(f.fetch('/api/admin/config')).rejects.toThrow('Unexpected fixture request')
  expect(f.controls.userConfigRequestCount).toBe(1)

  // Admin succeeds
  f.controls.loginAs('admin')
  const adminRes = await f.fetch('/api/admin/config')
  expect(adminRes.status).toBe(200)
  expect(f.controls.adminConfigRequestCount).toBe(1)
})
