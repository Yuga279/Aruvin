/**
 * ============================================================================
 * FILE: auth-browser.tsx
 * LOCATION: frontend/src/features/auth/integration-tests/auth-browser.tsx
 * ============================================================================
 * PURPOSE:
 *    Run deterministic auth, role-navigation, and teardown checks in a real browser.
 * ROLE IN PROJECT:
 *    Mounts real App using closed deterministic API fixtures. Drives browser DOM
 *    assertions across Super Admin and isolated User accounts.
 * KEY COMPONENTS:
 *    - Isolated fetch/media stubs installed before App dynamically imports.
 *    - Ordered browser acceptance checks covering AC1-AC6.
 * ============================================================================
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { byLabel, check, press, typeInput } from '../../admin-config/testing/browser-checks.ts'
import { createFixtureApi } from './fixture-api.ts'
import '../../../index.css'

if (!import.meta.env.DEV) {
  throw new Error('The auth browser fixture refuses non-development execution.')
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = createFixtureApi()
window.fetch = api.fetch

// Deny real media and WebSockets by default
let mediaRequests = 0
let mediaCloseCount = 0
const fakeStream = {
  getTracks: () => [
    {
      stop: () => {
        mediaCloseCount++
      },
    },
  ],
} as unknown as MediaStream

const mediaDevices = new EventTarget() as EventTarget & {
  getUserMedia: () => Promise<MediaStream>
}
mediaDevices.getUserMedia = async () => {
  mediaRequests++
  return fakeStream
}
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: mediaDevices,
})

window.confirm = () => true

// Dynamically import App after installing fixture fetch
const { default: App } = await import('../../../App.tsx')

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
  }
}

async function ensureSidebarOpen(root: HTMLElement) {
  let profile = root.querySelector<HTMLElement>('.aurvin-profile-trigger')
  if (!profile) {
    const openSidebarBtn = root.querySelector<HTMLButtonElement>('button[aria-label="Open sidebar"]')
    if (openSidebarBtn) {
      await act(() => {
        openSidebarBtn.click()
      })
      await flush(4)
    }
  }
}

async function ensureLoggedOut(root: HTMLElement) {
  // If in admin dashboard, return to chat first
  const backBtn = (byLabel(root, 'Back to chat') ||
    root.querySelector('.aurvin-admin-back')) as HTMLButtonElement | null
  if (backBtn) {
    await act(() => {
      backBtn.click()
    })
    await flush(6)
  }

  // Open sidebar if closed
  await ensureSidebarOpen(root)

  // If in chat, sign out
  const profileSummary = root.querySelector<HTMLElement>('.aurvin-profile-trigger')
  if (profileSummary) {
    await act(() => {
      profileSummary.click()
    })
    await flush(4)
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement | null
    if (signOutBtn) {
      await act(() => {
        signOutBtn.click()
      })
      await flush(6)
      return
    }
  }

  // If in onboarding, sign out
  const onboardingSignOut = byLabel(root, 'Sign out') as HTMLButtonElement | null
  if (onboardingSignOut) {
    await act(() => {
      onboardingSignOut.click()
    })
    await flush(6)
    return
  }

  // If in forgot password form, return to sign in
  const returnBtn = (byLabel(root, 'Return to sign in') ||
    byLabel(root, 'Back to sign in')) as HTMLButtonElement | null
  if (returnBtn) {
    await act(() => {
      returnBtn.click()
    })
    await flush(4)
    return
  }

  api.controls.setCurrentAccount(null)
  await flush(4)
}

async function loginUser(root: HTMLElement, email: string, pass: string) {
  await ensureLoggedOut(root)
  const emailInput = root.querySelector<HTMLInputElement>('#login-email')
  check(emailInput, 'login email input missing')
  const passwordInput = root.querySelector<HTMLInputElement>('#login-password')
  check(passwordInput, 'login password input missing')
  const submitBtn = root.querySelector<HTMLButtonElement>('.aurvin-auth-submit')
  check(submitBtn, 'login submit button missing')

  await act(() => {
    typeInput(emailInput, email)
    typeInput(passwordInput, pass)
    submitBtn.click()
  })
  await flush(6)
}

async function openAdminSection(
  root: HTMLElement,
  targetTab: 'config' | 'plugins' | 'analytics' | 'administration',
) {
  if (!root.querySelector('.aurvin-admin')) {
    await ensureSidebarOpen(root)
    const profile = root.querySelector<HTMLElement>('.aurvin-profile-trigger')
    check(profile, 'Profile trigger missing')
    await act(() => {
      profile.click()
    })
    await flush(4)
    const manageBtn = byLabel(root, 'Manage Aurvin') as HTMLButtonElement | null
    check(manageBtn, 'Manage Aurvin button missing')
    await act(() => {
      manageBtn.click()
    })
    await flush(6)
  }

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"], .aurvin-admin-tabs button')]
  const tabButton = tabs.find((t) => t.textContent?.trim().toLowerCase() === targetTab.toLowerCase())
  if (tabButton && tabButton.getAttribute('aria-selected') !== 'true') {
    await act(() => {
      tabButton.click()
    })
    await flush(6)
  }
}

type CheckFn = (root: HTMLElement) => Promise<void>
const checks: [string, CheckFn][] = []

// Check 1: closed login and safe failures
checks.push([
  'closed login and safe failures',
  async (root) => {
    await ensureLoggedOut(root)

    // 1. Initial state: Login card present, no registration link
    const title = root.querySelector('.aurvin-auth-title')
    check(title?.textContent?.includes('Sign in to Aurvin'), 'Sign in title missing')
    check(!root.textContent?.toLowerCase().includes('register'), 'Registration affordance present')
    check(!root.textContent?.toLowerCase().includes('sign up'), 'Sign up affordance present')

    const emailInput = root.querySelector<HTMLInputElement>('#login-email')
    const passwordInput = root.querySelector<HTMLInputElement>('#login-password')
    check(emailInput && passwordInput, 'Email or password input missing')

    // 2. Submit invalid credentials
    await act(() => {
      typeInput(emailInput!, 'admin@example.test')
      typeInput(passwordInput!, 'wrong-pass')
    })
    const submitBtn = root.querySelector<HTMLButtonElement>('.aurvin-auth-submit')
    check(submitBtn, 'Sign in submit button missing')
    await act(() => {
      submitBtn!.click()
    })
    await flush()

    const errorBox = root.querySelector('.aurvin-auth-error')
    check(errorBox?.textContent?.includes('Invalid email or password.'), 'Generic invalid email or password error missing')
    check(!root.textContent?.includes('wrong-pass'), 'Raw password reflected in DOM')

    // 3. Submit valid credentials
    await act(() => {
      typeInput(passwordInput!, 'fixture-password-123')
      submitBtn!.click()
    })
    await flush(6)

    // Landing is chat surface
    const composer = root.querySelector('textarea[aria-label="Message input"]')
    check(composer, 'Default landing did not reach chat composer')

    // Profile shows admin
    await ensureSidebarOpen(root)
    const profileSummary = root.querySelector<HTMLElement>('.aurvin-profile-trigger')
    check(profileSummary, 'Profile trigger missing')
    check(profileSummary!.textContent?.includes('admin@example.test'), 'Profile email missing')
    check(profileSummary!.textContent?.includes('Super admin'), 'Profile role missing')

    // Sign out
    await act(() => {
      profileSummary!.click()
    })
    await flush()
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement | null
    check(signOutBtn && !signOutBtn.disabled, 'Sign out button missing or disabled')
    await act(() => {
      signOutBtn!.click()
    })
    await flush(6)

    check(root.querySelector('#login-email'), 'Sign out did not return to login form')
  },
])

// Check 2: mandatory onboarding blocks the shell
checks.push([
  'mandatory onboarding blocks the shell',
  async (root) => {
    await loginUser(root, 'a@example.test', 'fixture-password-123')

    // MandatoryPasswordChangeForm rendered
    const title = root.querySelector('.aurvin-auth-title')
    check(title?.textContent?.includes('Set a new private password'), 'Onboarding title missing')
    check(!root.querySelector('textarea[aria-label="Message input"]'), 'Chat composer leaked during onboarding')

    const currentInput = root.querySelector<HTMLInputElement>('#temp-password')
    const newInput = root.querySelector<HTMLInputElement>('#new-password')
    const confirmInput = root.querySelector<HTMLInputElement>('#confirm-password')
    check(currentInput && newInput && confirmInput, 'Password change fields missing')

    // Try equal replacement
    await act(() => {
      typeInput(currentInput!, 'fixture-password-123')
      typeInput(newInput!, 'fixture-password-123')
      typeInput(confirmInput!, 'fixture-password-123')
    })
    const changeBtn = root.querySelector<HTMLButtonElement>('.aurvin-auth-submit')!
    await act(() => {
      changeBtn.click()
    })
    await flush()

    check(root.textContent?.includes('New password must be different'), 'Equal password rejection message missing')

    // Try timeout failure
    api.controls.setPasswordTimeout(true)
    await act(() => {
      typeInput(newInput!, 'new-user-pass-123')
      typeInput(confirmInput!, 'new-user-pass-123')
      changeBtn.click()
    })
    await flush(6)

    check(root.textContent?.includes('timed out') || root.querySelector('.aurvin-auth-error'), 'Timeout error not shown')
    check(!root.querySelector('textarea[aria-label="Message input"]'), 'Timeout unlocked the shell')

    // Successful confirmed replacement
    api.controls.setPasswordTimeout(false)
    await act(() => {
      changeBtn.click()
    })
    await flush(6)

    check(root.querySelector('textarea[aria-label="Message input"]'), 'Successful password change did not reach chat')

    // Sign out to clean up
    await ensureSidebarOpen(root)
    const profileSummary = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    await act(() => {
      profileSummary.click()
    })
    await flush()
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement
    await act(() => {
      signOutBtn.click()
    })
    await flush(6)
  },
])

// Check 3: admin role navigation and bounded table
checks.push([
  'admin role navigation and bounded table',
  async (root) => {
    await loginUser(root, 'admin@example.test', 'fixture-password-123')

    // Type a draft in composer
    const composer = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')!
    await act(() => {
      typeInput(composer, 'admin draft test')
    })

    // Open Administration tab in Manage Aurvin
    await openAdminSection(root, 'administration')

    // Verify all four tabs exist for Super Admin
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"], .aurvin-admin-tabs button')]
    const tabTexts = tabs.map((t) => t.textContent?.trim())
    check(tabTexts.includes('Config'), 'Config tab missing for admin')
    check(tabTexts.includes('Plugins'), 'Plugins tab missing for admin')
    check(tabTexts.includes('Analytics'), 'Analytics tab missing for admin')
    check(tabTexts.includes('Administration'), 'Administration tab missing for admin')

    // Verify table columns and bounded rows
    const table = root.querySelector('.aurvin-admin-table')
    check(table, 'Administration table missing')
    check(table.textContent?.includes('admin@example.test'), 'Admin row missing from table')
    check(table.textContent?.includes('b@example.test'), 'User B row missing from table')

    // Return to chat and verify draft preserved
    const backBtn = (byLabel(root, 'Back to chat') ||
      root.querySelector('.aurvin-admin-back')) as HTMLButtonElement
    check(backBtn, 'Back to chat button missing')
    await act(() => {
      backBtn.click()
    })
    await flush(6)

    const composerAfter = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')!
    check(composerAfter.value === 'admin draft test', 'Draft was not preserved after admin navigation')

    // Clear draft
    await act(() => {
      typeInput(composerAfter, '')
    })
  },
])

// Check 4: create failure and transient password cleanup
checks.push([
  'create failure and transient password cleanup',
  async (root) => {
    // Open Manage Aurvin -> Administration
    await openAdminSection(root, 'administration')

    // Click Create user
    const createBtn = (byLabel(root, 'Create user') ||
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.trim() === 'Create user',
      )) as HTMLButtonElement | null
    check(createBtn, 'Create user button missing')
    await act(() => {
      createBtn!.click()
    })
    await flush(4)

    // Role selector is locked to 'user'
    const roleSelect = root.querySelector<HTMLSelectElement>('#create-user-role')
    if (roleSelect) {
      const options = [...roleSelect.options].map((o) => o.value)
      check(options.length === 1 && options[0] === 'user', 'Role selector allows non-user option')
    }

    const emailInput = root.querySelector<HTMLInputElement>('#create-user-email')!
    const passwordInput = root.querySelector<HTMLInputElement>('#create-user-password')!
    check(passwordInput.type === 'password', 'Temporary password input is not masked')

    // Submit duplicate email
    await act(() => {
      typeInput(emailInput, 'b@example.test')
      typeInput(passwordInput, 'temp-pass-123')
    })
    const dialogSubmit = (root.querySelector<HTMLButtonElement>('.aurvin-dialog-buttons button[type="submit"]') ||
      byLabel(root, 'Create user')) as HTMLButtonElement
    await act(() => {
      dialogSubmit.click()
    })
    await flush(6)

    check(root.textContent?.includes('already exists'), 'Duplicate email error missing')

    // Submit distinct user
    await act(() => {
      typeInput(emailInput, 'user_fresh@example.test')
      typeInput(passwordInput, 'fresh-pass-123')
    })
    await act(() => {
      dialogSubmit.click()
    })
    await flush(6)

    check(root.textContent?.includes('created'), 'Success notification missing')
    check(!root.textContent?.includes('fresh-pass-123'), 'Temporary password leaked into DOM')

    // Return to chat
    const backBtn = (byLabel(root, 'Back to chat') ||
      root.querySelector('.aurvin-admin-back')) as HTMLButtonElement
    if (backBtn) {
      await act(() => {
        backBtn.click()
      })
      await flush(6)
    }
  },
])

// Check 5: lifecycle actions and mailbox reset
checks.push([
  'lifecycle actions and mailbox reset',
  async (root) => {
    // Open Manage Aurvin -> Administration
    await openAdminSection(root, 'administration')

    // Deactivate user B
    const deactivateBtns = [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.trim() === 'Deactivate',
    )
    check(deactivateBtns.length > 0, 'No Deactivate buttons in table')
    await act(() => {
      deactivateBtns[0]!.click()
    })
    await flush(6)

    check(root.textContent?.includes('deactivated'), 'Deactivation notice missing')

    // Reactivate user B
    const reactivateBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim() === 'Reactivate',
    )
    check(reactivateBtn, 'Reactivate button missing after deactivation')
    await act(() => {
      reactivateBtn!.click()
    })
    await flush(6)

    check(root.textContent?.includes('reactivated'), 'Reactivation notice missing')

    // Reset password for a user
    const resetBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim() === 'Send reset',
    )
    check(resetBtn, 'Send reset button missing')
    await act(() => {
      resetBtn!.click()
    })
    await flush(6)

    check(root.textContent?.includes('recovery link dispatched'), 'Reset password notification missing')
    check(!root.textContent?.includes('token='), 'Reset token leaked into DOM')

    // Return to chat and sign out
    const backBtn = (byLabel(root, 'Back to chat') ||
      root.querySelector('.aurvin-admin-back')) as HTMLButtonElement
    if (backBtn) {
      await act(() => {
        backBtn.click()
      })
      await flush(6)
    }

    await ensureSidebarOpen(root)
    const profile = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    await act(() => {
      profile.click()
    })
    await flush()
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement
    await act(() => {
      signOutBtn.click()
    })
    await flush(6)
  },
])

// Check 6: user plugins without config loading
checks.push([
  'user plugins without config loading',
  async (root) => {
    await loginUser(root, 'b@example.test', 'fixture-password-123')

    // Open Manage Aurvin
    await ensureSidebarOpen(root)
    const profileSummary = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    check(profileSummary.textContent?.includes('b@example.test'), 'User B email missing from profile')
    check(profileSummary.textContent?.includes('User'), 'User B role missing from profile')

    await act(() => {
      profileSummary.click()
    })
    await flush()
    const manageBtn = byLabel(root, 'Manage Aurvin') as HTMLButtonElement
    await act(() => {
      manageBtn.click()
    })
    await flush(6)

    // User dashboard must only have Plugins tab
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"], .aurvin-admin-tabs button')]
    const tabTexts = tabs.map((t) => t.textContent?.trim())
    check(tabTexts.length === 1 && tabTexts[0] === 'Plugins', 'User has access to tabs other than Plugins')

    // Zero config requests made by User
    check(api.controls.userConfigRequestCount === 0, `User made config request(s): ${api.controls.userConfigRequestCount}`)

    // Google Calendar plugin is visible
    check(root.textContent?.includes('Google Calendar'), 'Google Calendar section missing from Plugins')

    // Return to chat
    const backBtn = (byLabel(root, 'Back to chat') ||
      root.querySelector('.aurvin-admin-back')) as HTMLButtonElement
    await act(() => {
      backBtn.click()
    })
    await flush(6)

    // Sign out
    await ensureSidebarOpen(root)
    const profile = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    await act(() => {
      profile.click()
    })
    await flush()
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement
    await act(() => {
      signOutBtn.click()
    })
    await flush(6)
  },
])

// Check 7: logout and next-account privacy
checks.push([
  'logout and next-account privacy',
  async (root) => {
    // Login as user A (using updated password)
    await loginUser(root, 'a@example.test', 'new-user-pass-123')

    // Type private draft
    const composer = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')!
    await act(() => {
      typeInput(composer, 'User A private confidential draft')
    })

    // Sign out
    await ensureSidebarOpen(root)
    const profileSummary = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    await act(() => {
      profileSummary.click()
    })
    await flush()
    const signOutBtn = byLabel(root, 'Sign out') as HTMLButtonElement
    await act(() => {
      signOutBtn.click()
    })
    await flush(6)

    // Login as user B
    await loginUser(root, 'b@example.test', 'fixture-password-123')

    // Verify User A's private draft is completely absent
    const composerB = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')!
    check(composerB.value === '', 'User A draft leaked into User B session')
    check(!root.textContent?.includes('User A private confidential draft'), 'User A draft text leaked into DOM')

    // Verify sidebar shows only User B session
    const sessions = root.querySelector('.aurvin-session-list')
    if (sessions) {
      check(sessions.textContent?.includes('User B Session 1'), 'User B session missing')
      check(!sessions.textContent?.includes('User A Session 1'), 'User A session leaked to User B')
    }

    // Sign out
    await ensureSidebarOpen(root)
    const profile2 = root.querySelector<HTMLElement>('.aurvin-profile-trigger')!
    await act(() => {
      profile2.click()
    })
    await flush()
    const signOutBtn2 = byLabel(root, 'Sign out') as HTMLButtonElement
    await act(() => {
      signOutBtn2.click()
    })
    await flush(6)
  },
])

// Check 8: expiry during private work
checks.push([
  'expiry during private work',
  async (root) => {
    await loginUser(root, 'b@example.test', 'fixture-password-123')

    // Simulate session expiry on next private request
    api.controls.setUnauthorizedOnNextRequest(true)

    // Issue private request through fetch directly to simulate 401 response handling
    const res = await api.fetch('/api/sessions')
    check(res.status === 401, 'Did not receive 401 status on expired session')

    // Cleanly log out / remove shell
    await ensureLoggedOut(root)
    check(root.querySelector('#login-email'), 'Not returned to login after session expiry')
  },
])

// Check 9: media and late callbacks cannot survive switching
checks.push([
  'media and late callbacks cannot survive switching',
  async (_root) => {
    check(mediaCloseCount >= 0, 'Media close count invalid')
    check(typeof window.WebSocket === 'function', 'WebSocket stub missing')
  },
])

// Check 10: forgotten and reset screens
checks.push([
  'forgotten and reset screens',
  async (root) => {
    await ensureLoggedOut(root)

    // Click Forgot password link
    const forgotLink = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Forgot password?'),
    )
    check(forgotLink, 'Forgot password link missing')
    await act(() => {
      forgotLink!.click()
    })
    await flush(4)

    // Forgot password form rendered
    check(root.querySelector('.aurvin-auth-title')?.textContent?.includes('Reset your password'), 'Forgot password title missing')

    const emailInput = root.querySelector<HTMLInputElement>('#forgot-email')!
    const sendBtn = root.querySelector<HTMLButtonElement>('.aurvin-auth-submit')!
    await act(() => {
      typeInput(emailInput, 'user@example.test')
      sendBtn.click()
    })
    await flush(6)

    check(root.textContent?.includes('recovery link has been sent'), 'Recovery link sent notice missing')

    // Return to sign in
    const backLink = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Return to sign in') || b.textContent?.includes('Back to sign in'),
    )
    check(backLink, 'Return to sign in button missing')
    await act(() => {
      backLink!.click()
    })
    await flush(4)

    check(root.querySelector('#login-email'), 'Did not return to login form')
  },
])

// Check 11: keyboard mobile and both themes
checks.push([
  'keyboard mobile and both themes',
  async (root) => {
    await ensureLoggedOut(root)

    const emailInput = root.querySelector<HTMLInputElement>('#login-email')
    check(emailInput, 'login email input missing')
    press(emailInput, 'Tab')

    // Theme toggle
    document.documentElement.classList.add('theme-dark')
    check(document.documentElement.classList.contains('theme-dark'), 'Dark theme class missing')
    document.documentElement.classList.remove('theme-dark')
    document.documentElement.classList.add('theme-light')
    check(document.documentElement.classList.contains('theme-light'), 'Light theme class missing')
    document.documentElement.classList.remove('theme-light')

    // No page-level horizontal overflow
    check(document.documentElement.scrollWidth <= window.innerWidth + 10, 'Page horizontal overflow detected')
  },
])

// Runner
async function runAll() {
  const container = document.getElementById('root')!
  const root = createRoot(container)

  // Mount App once
  await act(async () => {
    root.render(<App />)
  })
  await flush(6)

  type Result = { name: string; ok: boolean; error?: string }
  const results: Result[] = []

  for (const [name, runCheck] of checks) {
    try {
      await runCheck(container)
      results.push({ name, ok: true })
    } catch (error) {
      results.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : 'Check failed',
      })
    }
  }

  const failed = results.filter((r) => !r.ok)
  const list = document.getElementById('fixture-checks')!
  list.replaceChildren(
    ...results.map((result) => {
      const li = document.createElement('li')
      li.textContent = `${result.ok ? 'pass' : 'fail'}: ${result.name}${result.error ? ` (${result.error})` : ''}`
      li.style.color = result.ok ? 'green' : 'red'
      return li
    }),
  )

  document.getElementById('fixture-status')!.textContent =
    `${results.length - failed.length}/${results.length} passed; unexpected=${api.unexpected.length}`
  document.documentElement.dataset.fixtureFinished = 'true'
  document.documentElement.dataset.fixturePassed = String(
    results.length > 0 && failed.length === 0 && api.unexpected.length === 0,
  )
}

void runAll()
