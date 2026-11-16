# Current state (as of Release 0, 16 November 2026)

Aurvin started as the Alfred codebase. It now lives in `D:\Source6\Aruvin` as a fresh git repository with **no Alfred history**: there are no commits yet. The full description of the inherited system is [`docs/aurvin-rebuild-spec.md`](../aurvin-rebuild-spec.md); treat that as the reference and this page as the summary.

## Repository layout

| Path | What it is |
| --- | --- |
| `backend/` | NestJS 12 modular monolith (TypeScript ESM, `.js` import specifiers). Own `package.json` and lockfile. |
| `frontend/` | React 19 + Vite 8 + TypeScript 6 SPA. Own `package.json` and lockfile. |
| `deployment/` | Render template and NGINX gateway config for protected staging. |
| `docs/` | Workstream docs (`<workstream>/goal.md`, `plan*.md`, `state.md`, …) plus the Aurvin docs added in Release 0. |

There is no root workspace, pnpm or turbo. Both packages need Node `^22.22.3 || ^24.15.0 || >=26.0.0`.

## Backend modules (`backend/src`)

- `platform`: config, crypto, identity, redaction
- `contracts`: wire and storage types with runtime guards
- `auth`: WorkOS password sessions
- `administration`: user management
- `admin-config`: Manage Aurvin settings, encrypted credentials
- `http`: chat REST + SSE
- `chat-runtime`: durable turn engine, recovery, calendar tool loop
- `agent`: LangGraph turn graph
- `context`: prompt assembly within budgets
- `model`: OpenRouter adapter, accounting
- `persistence`: MongoDB repositories
- `voice`: Deepgram, LiveKit
- `plugins/google-calendar`
- `operations`: readiness, admission, drain, telemetry, recovery
- `benchmark`

## Frontend modules (`frontend/src`)

| Area | Location |
| --- | --- |
| Shell and auth routing (no URL router) | `App.tsx`, `features/auth` |
| Chat state, streaming, recovery | `features/chat` (reducer + `use-chat.ts`), `api/client.ts`, `api/protocol.ts` |
| Canvas (hand-written SVG renderers) | `features/canvas` |
| Voice (dictation, LiveKit live voice) | `features/voice`, `api/voice-*`, `api/livekit-voice-client.ts` |
| Manage Aurvin and user admin | `features/admin-config` |
| Google Calendar plugin UI | `features/plugins/google-calendar` |
| **Release 0:** tokens, theme, navigation model, brand | `styles/tokens.css`, `app/` |
| **Release 0:** design-system primitives | `ui/` |
| **Release 0:** brand mark, command palette | `components/BrandMark.tsx`, `components/CommandPalette.tsx`, `components/command-palette.ts` |

## MongoDB collections

`sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes`, plus `config`, users, and the calendar and accounting collections described in the rebuild spec.

## Behaviour worth knowing before changing anything

- **Streaming is provisional.** Only the SSE `completed` event finalises a turn; EOF without it means "interrupted". Retry creates a new attempt for the same turn.
- **The browser holds no secrets.** The only browser setting is `VITE_API_BASE=/api`.
- **One executor per database.** Never run two backends against one MongoDB.
- **Auth.** WorkOS email/password with `super-admin` and `user` roles. Authorization is enforced server-side.

## The Aurvin rename (16 November 2026)

Every `alfred`, `Alfred`, `auvrin` and `Auvrin` in the repository was replaced with `aurvin` / `Aurvin`. This covered code, CSS class and variable prefixes, environment variable names (`ALFRED_*` → `AURVIN_*`), the calendar CSRF header (`X-Aurvin-Calendar-CSRF`), cookie and storage keys, and file names such as `public/aurvin-logo.png`. Frontend and backend agree on the renamed wire contracts (checked in Release 0).

Data and sessions stored under the old names are not migrated. That doesn't matter for a fresh environment, but would for an existing Alfred database.

## Verification baseline (16 November 2026, Node 24.21.0)

| Package | Build | Lint | Tests |
| --- | --- | --- | --- |
| frontend, before Release 0 | pass | 0 errors / 96 warnings | 782 passed, 97 files |
| frontend, after Release 0 | pass | 0 errors / 97 warnings | 844 passed, 102 files |
| backend, after the rename | pass | 0 errors / 687 warnings | 3,181 passed / 27 failed / 10 skipped |

The 27 backend failures are in six files:

- `test/performance/durable-latency.spec.ts` (timing gates)
- `test/performance/memory-text-archive.spec.ts`
- `test/runtime/calendar-recovery-unavailable.spec.ts`
- `test/runtime/finalization-repair.spec.ts`
- `test/operations/launcher.spec.ts`
- `test/assembly/calendar-simplification.built.spec.ts`

The same six fail on the original pre-rename Alfred backend, so they predate Aurvin. Backend e2e, Azure and behavior suites were not run because they need MongoDB and provider credentials.
