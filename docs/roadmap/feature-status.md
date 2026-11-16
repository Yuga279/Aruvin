# Feature status

**Statuses:** Planned · In progress · Implemented · Tested · Production verified · Blocked.

"Tested" means automated tests exist and passed on 16 November 2026 (Node 24.21.0). Nothing here is **Production verified**: no live deployment, provider drill or browser end-to-end run has been done for Aurvin.

## Inherited from Alfred

| Feature | Status | Evidence and notes |
| --- | --- | --- |
| Text chat: streaming, cancel, retry, terminal outcomes, recovery after refresh, save state | Tested | Frontend chat suites pass; backend runtime suites pass except the 3 inherited failures below |
| Sessions: list, rename, pin, delete | Tested | |
| WorkOS login, password reset, forced password change, roles | Tested | Needs WorkOS settings to run for real |
| Manage Aurvin (settings, encrypted credentials) | Tested | |
| User administration | Tested | |
| Analytics tab | Planned | Tab exists but is empty |
| Google Calendar: connect, multiple calendars, availability, create with confirmation | Tested | Edit, reschedule and delete are Planned (Release 6) |
| Dictation (Deepgram) | Tested | Offline fixtures only |
| Live voice (LiveKit) | Implemented | No live LiveKit drill has been run |
| Canvas: diagrams, charts, SVG, calendar; copy and download | Tested | Diagram types beyond flowchart and sequence aren't confirmed to render correctly |
| Safe Markdown (no HTML injection) | Tested | No tables or nested lists yet |
| Operations: readiness, admission, drain, recovery, accounting | Tested | Backend `launcher.spec.ts` fails, also on the original Alfred backend |
| Azure database support | Blocked | Service details unknown |

## Release 0

| Feature | Status | Evidence |
| --- | --- | --- |
| Design tokens (dark default + light), contrast-checked | Tested | `styles/tokens.test.ts` |
| Theme switch: System / Dark / Light, saved per browser | Tested | `app/theme/theme.test.ts`; visual check in both themes |
| Aurvin branding (temporary emblem until official logo files arrive) | Tested | Brand assertions in Sidebar, EmptyState and auth tests |
| Flag-aware sidebar navigation (Integrations, Settings) | Tested | `app/navigation.test.ts`, `components/Sidebar.test.ts` |
| Command palette (Ctrl/Cmd+K) | Tested | `components/CommandPalette.test.ts`; visual check |
| Design-system primitives (`ui/`) | Tested | `ui/ui.test.ts` |
| Shared dialog focus trap (ConfirmDialog, palette) | Tested | ConfirmDialog suite unchanged and passing |

## Hidden behind flags (Planned)

Home, Projects (R5), Agents (R3), Memory (R5), Workspace (R2), Automations (R8).

## Known issues

| Issue | Status |
| --- | --- |
| 27 backend tests in 6 files fail, identically on the original Alfred backend: `durable-latency` (timing gates), `memory-text-archive`, `calendar-recovery-unavailable`, `finalization-repair`, `operations/launcher`, `assembly/calendar-simplification.built` | Blocked (needs investigation; predates Aurvin) |
| Backend e2e, Azure and behavior suites not run | Needs MongoDB and provider credentials |
| Browser end-to-end tests never run | Planned |
| Frontend bundle is 1.19 MB (warning existed before Release 0) | Planned: code-split in Release 2 |
