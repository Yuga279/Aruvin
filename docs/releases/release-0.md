# Release 0: Foundation and design system

**Status:** Tested. Awaiting approval. Not production verified. **Date:** 16 November 2026. **Branch:** none (the repository has no commits yet).

## What changed for users

- **Aurvin branding** on every screen: sidebar, welcome screen (with the tagline), profile menu, auth screens, page title and favicon. The emblem is **temporary** until the official logo files are supplied.
- **New colour system** in dark (the default) and light, contrast-checked against WCAG AA.
- **Theme switch** (System / Dark / Light) in the profile menu and the command palette. The choice is saved per browser.
- **Workspace navigation** in the sidebar, showing only areas that work today: Integrations and Settings. Projects, Agents, Memory, Workspace, Automations and Home stay hidden behind feature flags until their releases.
- **Command palette** on Ctrl/Cmd+K or the sidebar's Search entry: new chat, Integrations, Settings, theme, and jump to a loaded chat by title.
- **Composer focus ring.** The composer now shows a visible ring when focused; before, it had no focus indication.

Everything else works as before: chat streaming, cancel, retry, recovery, sessions, Canvas, voice, Manage Aurvin, user admin and Google Calendar.

## Files

### Created (`frontend/`)

- `src/styles/tokens.css`, `src/styles/shell.css`, `src/styles/tokens.test.ts`
- `src/app/brand.ts`, `src/app/feature-flags.ts`, `src/app/navigation.ts`, `src/app/navigation.test.ts`
- `src/app/theme/theme.ts`, `src/app/theme/ThemeProvider.tsx`, `src/app/theme/theme.test.ts`
- `src/ui/primitives.tsx`, `src/ui/Dialog.tsx`, `src/ui/index.ts`, `src/ui/ui.css`, `src/ui/ui.test.ts`
- `src/components/BrandMark.tsx`, `src/components/CommandPalette.tsx`, `src/components/command-palette.ts`, `src/components/CommandPalette.test.ts`
- `public/aurvin-mark.svg`

### Modified (`frontend/`)

| Area | Files |
| --- | --- |
| Entry points | `index.html`, `src/main.tsx`, `src/App.tsx` |
| Tokens and theme | `src/index.css` (imports tokens; light theme via `data-theme`) |
| Light-theme conversion | `src/styles/chat.css` (also composer focus ring, tagline, overlay and shadow tokens), `src/styles/scrollbars.css`, `src/components/confirm-dialog.css` |
| Shell | `src/components/Sidebar.tsx`, `src/components/EmptyState.tsx`, `src/components/ConfirmDialog.tsx` (shared focus trap), `src/components/icons.tsx`, `src/features/chat/ChatView.tsx` |
| Profile and admin | `src/features/admin-config/ProfileMenu.tsx`, `AdminDashboard.tsx` |
| Auth | The four auth forms and `auth-context.tsx` |
| Product name in text | The Composer, Canvas, calendar and voice components that showed it |
| Tests and fixtures | Tests and browser fixtures that asserted the old brand strings or logo |

### Repository-wide rename (done separately, outside the release work)

Every `alfred`, `Alfred`, `auvrin` and `Auvrin` was replaced with `aurvin` / `Aurvin` in frontend, backend, deployment and docs (about 450 files). Release 0 verified the result:

- No undefined CSS variables and no class collisions.
- The calendar CSRF header and auth wire contract match on frontend and backend.
- Backend build passes.

## Database and API changes

None.

## Tests

| Check | Result |
| --- | --- |
| Frontend build | Pass |
| Frontend lint | 0 errors, 97 warnings (baseline 96) |
| Frontend tests | 844 passed in 102 files (baseline 782 in 97; none removed) |
| Backend build | Pass |
| Backend lint | 0 errors, 687 warnings |
| Backend tests | 3,181 passed, **27 failed**, 10 skipped. All 27 failures are in six files that fail identically on the original pre-rename Alfred backend. See [feature-status](../roadmap/feature-status.md). |
| Visual check | 24 headless-Chrome screenshots, both themes, at 1280, 900 and 390 px. No unexpected API calls or page errors. |
| Not run | Backend e2e, Azure and behavior suites (need MongoDB and provider credentials); browser end-to-end tests; screen-reader testing |

## Deployment and local setup

No new services or dependencies. This folder has no `backend/.env`; create one from `backend/.env.example`. Variable names now use the `AURVIN_` prefix, for example `AURVIN_CONFIG_ENCRYPTION_KEY` and `AURVIN_USER_ID`.

If you point Aurvin at an existing Alfred MongoDB:

- Set `AURVIN_CONFIG_ENCRYPTION_KEY` to the old encryption key value, or stored credentials can't be decrypted.
- Data keyed by the old names isn't migrated.

## Known issues and follow-ups

- Official Aurvin logo files are needed; replace `components/BrandMark.tsx` and `public/aurvin-mark.svg`.
- The six inherited failing backend test files need fixing before regressions can be told apart from old failures.
- `public/aurvin-logo.png`, `aurvin-favicon.ico` and `aurvin-favicon-32.png` are the old Alfred artwork under new names and are no longer referenced. Delete them once confirmed.

## Recommended next release

**Release 1: Modern conversation.** It adds server-side conversation search, edit and regenerate, feedback and Markdown export. Fixing the inherited backend test failures first is recommended.
