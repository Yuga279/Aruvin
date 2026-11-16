# Target state

Aurvin (Autonomous Unified Vision, Reasoning & Intelligence Network; "Beyond assistance. Into intelligence.") is an AI-native workspace. It combines conversational AI, agents, persistent memory, voice, generative UI, tools, research and productivity features.

## Shape

A **modular monolith** in one repository, with independently deployable processes that share the codebase:

```text
apps/web            React SPA (today: frontend/)
apps/api            NestJS HTTP + SSE (today: backend/)
apps/agent-worker   long-running agent execution          (later)
apps/job-worker     BullMQ scheduled and background jobs  (Release 8)
packages/contracts  wire types shared by web and api      (first shared package)
packages/ui, design-tokens, api-client, test-utils        (only when a second consumer exists)
```

This is a direction, not a migration order. `backend/` and `frontend/` stay where they are until a release needs a shared package. The first one will almost certainly be `contracts`, which is currently mirrored by hand between frontend and backend as `// BEGIN … WIRE` blocks. At that point a pnpm workspace comes in. Turbo is added only if build times justify it.

## Workspace UI

Three adaptive zones:

1. **Left sidebar.** Brand, new chat, search, workspace navigation, conversations, profile.
2. **Centre conversation.** Messages, streaming, tool and agent activity, composer.
3. **Right workspace panel.** Canvas artifacts, documents, code, calendar, research, task details.

On tablets the workspace panel overlays the conversation. On phones the layout is conversation-first, with full-screen artifacts and bottom navigation.

Release 0 delivers zone 1 and the visual system. Zone 3 is the existing Canvas panel inside `ChatView`; Release 2 generalises it into a workspace panel. Moving it earlier would risk Canvas focus restoration, live voice and the hidden-but-mounted admin page.

## Agent/frontend events

The SSE protocol (`STREAM_PROTOCOL_VERSION = 1`) stays the transport. New agent events (`task.plan`, `task.progress`, `tool.started`, `approval.required`, `artifact.created`, …) will be added as a **versioned** extension with compatibility tests, never by changing existing events. AG-UI is evaluated in Release 3, and A2UI alongside Canvas work in Release 2. Neither is adopted without a written decision. The UI never shows model chain-of-thought, only task summaries, observable tool activity and status.

## Libraries, added only when a release needs them

| Library | When |
| --- | --- |
| Tailwind 4 + shadcn/ui | Deferred. Revisit when a release builds many new screens; tokens are plain CSS variables that Tailwind's `@theme` can consume. |
| TanStack Query | When server-state screens multiply (likely Release 5) |
| TanStack Table | Release 2 (data tables) |
| React Flow, ECharts | Only if the hand-written SVG renderers stop being enough |
| Monaco, Tiptap | Release 7 |
| Redis + BullMQ | Release 8 |
