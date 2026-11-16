# Release plan

Each release ships one complete, user-facing slice. A release starts only after the previous one is approved. Within a release, work goes in this order: contracts → backend logic → database and indexes → API or events → frontend → loading, empty and error states → security → unit, integration and e2e tests → docs → release verification. Unfinished capabilities stay behind `frontend/src/app/feature-flags.ts`.

| Release | Scope | Status |
| --- | --- | --- |
| **0. Foundation and design system** | Repository audit, Aurvin branding, design tokens, light/dark/system themes, flag-aware sidebar navigation, command palette, design-system primitives | Tested. Awaiting your approval. See [release-0](../releases/release-0.md). |
| 1. Modern conversation | Conversation search (server-side, titles + message text), edit and regenerate, feedback, Markdown export, message rendering polish. *Streaming, cancel and retry already exist; this release keeps them working.* | Planned |
| 2. Canvas and workspace panel | Generalise Canvas into the right-hand workspace panel (resizable, full screen), PNG export, print, "Ask about this", data tables with sort and filter, more diagram types, calendar day/week views | Planned |
| 3. Agent execution | Versioned agent event contract, task plan and timeline, tool activity, approval cards enforced by backend policy, cancellation, execution history, general tool registry | Planned |
| 4. Voice and multimodal | Voice UI refresh, phone voice UX, file and image uploads with validation and limits | Planned |
| 5. Projects and memory | Projects (ownership, instructions, context), memory inspection, editing and deletion with audit | Planned |
| 6. Everyday integrations | Calendar edit, reschedule and delete; email; document storage. All writes need approval and credentials stay server-side. | Planned |
| 7. Documents and developer workspace | Word, Excel and PowerPoint generation; code editor; isolated code execution; live preview | Planned |
| 8. Automations and advanced intelligence | Scheduled and recurring tasks (BullMQ + Redis), web monitoring, deep research, multi-agent view, model selection | Planned |

## Dependencies and suggested next step

Release 1 has no new infrastructure dependency. Its one sizeable backend item is message-text search: it needs a MongoDB text index on `messages`, a migration note, and a decision on per-user index limits.

Before Release 1, two inherited items are worth fixing because they mask regressions:

- The six failing backend test files. These are tracked in [feature-status.md](feature-status.md).
- Browser end-to-end tests, which were never run in Alfred.
