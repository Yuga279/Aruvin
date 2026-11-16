/**
 * ============================================================================
 * FILE: App.assembly.test.ts
 * LOCATION: frontend/src/App.assembly.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify application shell assembly, voice start registration, and fail-closed binding.
 *
 * ROLE IN PROJECT:
 *    Verifies that the React shell wires live voice start without duplicate
 *    providers or immediate microphone capture, forwards session binding,
 *    and prevents client-side leaks of server voice configuration or secrets.
 *
 * KEY COMPONENTS:
 *    - registerVoiceStart test: ensures callback registration and cleanup.
 *    - bindLiveConversation test: forwards P7 bind action and fails closed if absent.
 *    - Shell mounting test: renders composer, verifies no client flags/secrets in source.
 * ============================================================================
 */

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { bindLiveConversation, registerVoiceStart } from './App.tsx'
import { initialLiveVoice } from './features/voice/state/live-voice-reducer.ts'

const seen: Array<{ conversationId: string | null; draft: string; bindings: {
  refreshSessions: () => void
  bindVoiceConversation: (token: string, conversationId: string) => boolean
} }> = []

vi.mock('./features/voice/dictation/useDictation.ts', () => ({
  useDictation: () => ({ config: null, locked: false, phase: 'idle', status: '', notice: null,
    start: () => undefined, stop: () => undefined, cancel: () => undefined }),
}))
vi.mock('./features/voice/state/useLiveVoice.ts', () => ({
  useLiveVoice: (options: (typeof seen)[number]) => {
    seen.push(options)
    return { view: initialLiveVoice, start: () => undefined, toggleMute: () => undefined,
      interrupt: () => undefined, exit: () => undefined, resume: () => undefined }
  },
}))

it('registers and clears only the current live start callback', () => {
  const ref: { current: (() => void) | null } = { current: null }
  const start = vi.fn()
  const stop = registerVoiceStart(ref, start)
  ref.current?.()
  expect(start).toHaveBeenCalledOnce()
  stop()
  ref.current?.()
  expect(start).toHaveBeenCalledOnce()
})

it('forwards a P7 bind action and fails closed when that action is absent', () => {
  expect(bindLiveConversation({}, 'lease-1', 'chat-1')).toBe(false)
  const bind = vi.fn(() => true)
  expect(bindLiveConversation({ bindVoiceConversation: bind }, 'lease-1', 'chat-1')).toBe(true)
  expect(bind).toHaveBeenCalledWith('lease-1', 'chat-1')
})

it('mounts one text shell and does not put voice flags or secrets in the client entry', async () => {
  const { default: App } = await import('./App.tsx')
  const html = renderToStaticMarkup(createElement(App, {
    initialAuthStatus: 'authenticated',
    initialAuthUser: {
      userId: 'usr-assembly',
      email: 'assembly@example.com',
      role: 'super-admin',
      passwordChangeRequired: false,
    },
    authClient: {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    },
  }))
  expect(html).toContain('Message composer')
  expect(html).not.toContain('Live voice conversation')
  expect(seen[0]?.conversationId).toBeNull()
  expect(seen[0]?.bindings.bindVoiceConversation('lease-1', 'chat-1')).toBe(false)
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
  expect(app).not.toMatch(/VITE_/)
  expect(main).toContain('<App />')
  expect(main).not.toMatch(/VITE_(?!API_BASE)/)
  expect(app + main).not.toMatch(/DEEPGRAM|ENABLE_LIVE_VOICE|ENABLE_DICTATION/)
})

it('accepts an injected calendarClient and scrubs OAuth callback URL parameters without storage writes', async () => {
  const { extractAndScrubCalendarOAuthCallback } = await import('./api/calendar-protocol.ts')
  const scrubbed = extractAndScrubCalendarOAuthCallback(
    'http://127.0.0.1:5173/?plugin=google-calendar&oauth=connected&code=secret&state=nonce',
  )
  expect(scrubbed).toEqual({
    outcome: 'connected',
    scrubbedPathAndSearch: '/',
    hadSensitiveParams: true,
  })
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('calendarClient?: CalendarClient')
  expect(app).not.toMatch(/localStorage|sessionStorage/)
})
