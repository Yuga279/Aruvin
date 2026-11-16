# FE-01 App shell: goal

Give Aurvin a consistent, branded shell that works on desktop, tablet and phone, without breaking any existing route or flow.

## In scope (Release 0)

- Aurvin branding in the sidebar, welcome screen, profile menu, auth screens, page title and favicon
- A System / Dark / Light theme switch that is saved per browser, with dark as the default
- Workspace navigation that shows only destinations backed by working code (Integrations, Settings), with every other area behind feature flags
- A command palette (Ctrl/Cmd+K) with shell actions, theme switching and jump-to-chat by title
- The existing responsive layout kept: desktop sidebar, slide-in drawer at 768 px and below, Canvas overlay at 900 px and below

## Out of scope

- A URL router
- Bottom navigation on phones (waits until there are enough real destinations)
- A notification centre
- Generalising Canvas into the workspace panel (Release 2)
