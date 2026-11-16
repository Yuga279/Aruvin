# Module boundaries

These rules apply from Release 0 onwards. They extend the conventions in [`AGENTS.md`](../../AGENTS.md).

## Rules

1. A module owns its business logic and its persistence. Other modules never touch its repositories or collections directly.
2. Modules talk through public application interfaces (exported services and functions) or domain events. There are no deep imports into another module's internals.
3. No circular dependencies between modules.
4. Backend `contracts/` and frontend `api/*-protocol.ts` hold wire types and guards only. Shared packages contain contracts and genuinely reusable utilities, nothing else.
5. Authorization is enforced on the server. Hiding something in the UI is never a security control.
6. External actions go through the tool registry and its policy checks. Today only the Google Calendar loop exists; a general registry is planned.
7. Background work needs durable execution records (Release 8).
8. Browser automation and code execution run in isolated infrastructure, never on the API host (Release 7).
9. The browser holds no secrets. The only `VITE_*` setting is `VITE_API_BASE`.

## Backend map

| Brief module | Existing location | Notes |
| --- | --- | --- |
| BE-01 Identity | `auth/`, `platform/identity` | WorkOS kept |
| BE-02 Conversations | `http/`, `chat-runtime/`, `persistence/` (sessions, messages) | The most sensitive code; change only with its tests |
| BE-03 Intelligence | `agent/`, `chat-runtime/` | LangGraph |
| BE-04 Model gateway | `model/` | OpenRouter adapter and accounting |
| BE-05 Context | `context/`, `instructions/` | |
| BE-06 Memory | `persistence/memory*`, `agent-memory` collection | UI and retrieval come in Release 5 |
| BE-07 Tools | `chat-runtime/calendar-*` | To be generalised |
| BE-08 Integrations | `plugins/google-calendar/` | |
| BE-09 Canvas | `contracts/canvas-artifact.ts` | Mostly frontend today |
| BE-10 Voice | `voice/` | |
| BE-14 Analytics | `persistence/accounting-*`, `operations/telemetry` | |
| BE-15 Administration | `administration/`, `admin-config/` | |
| BE-11 Projects, BE-12 Automations, BE-13 Notifications | not started | |

## Frontend map

| Brief module | Location |
| --- | --- |
| FE-01 App shell | `App.tsx`, `features/chat/ChatView.tsx` (layout), `components/Sidebar.tsx`, `components/CommandPalette.tsx`, `app/` |
| FE-02 Design system | `styles/tokens.css`, `ui/`, `styles/shell.css` |
| FE-03 Conversation | `features/chat`, `components/` (Transcript, MessageItem, Composer) |
| FE-06 Canvas | `features/canvas` |
| FE-07 Voice | `features/voice` |
| FE-11 Integrations | `features/plugins` |
| FE-12 Admin | `features/admin-config` |

## Frontend dependency direction

```text
app/ (brand, flags, navigation, theme)  ←  ui/  ←  components/  ←  features/*  ←  App.tsx
api/* (clients, protocol guards)        ←  features/*
```

- `ui/` imports nothing from `features/` or `api/`.
- A feature imports another feature only through that feature's `index.ts`.
- New CSS uses `aurvin-` classes and `--aurvin-*` tokens. Colours, radii, durations and shadows come from tokens, not literal values. `styles/tokens.test.ts` fails if any `var(--aurvin-*)` reference has no definition.
