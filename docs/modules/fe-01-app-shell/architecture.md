# FE-01 App shell: architecture

```text
main.tsx      applies the saved theme to <html data-theme> before the first render
App.tsx       ThemeProvider → AuthProvider → AppShell (auth routing) → ChatProvider → VoiceChatShell
ChatView      layout: Sidebar | main (header, transcript or empty state, composer) | CanvasPanel
              + CommandPalette (Ctrl/Cmd+K listener active only while the chat page is visible)
```

## Key decisions

- **No URL router.** Pages stay as `VoiceChatShell` state (`chat | admin`). Integrations opens Manage Aurvin → Plugins (the existing `onOpenCalendarSetup` path), and Settings opens Manage Aurvin (`onManageAlfred`). ChatView stays mounted, hidden and `inert`, under the admin page, so voice and streams survive.
- **One navigation model.** `app/navigation.ts` lists every planned area once. `shellNavItems()` binds visible items to handlers and feeds both the sidebar and the palette. Members (`user` role) don't get Settings, because their Manage Aurvin shows only Plugins, which would duplicate Integrations.
- **Feature flags are compile-time constants** (`app/feature-flags.ts`), not `VITE_*` settings. An enabled flag without a real destination still renders nothing.
- **Theme.** `app/theme/theme.ts` holds pure, testable logic: parse, resolve, guarded `localStorage` under `aurvin:theme`, apply. `ThemeProvider` follows the OS setting live while the preference is "system". Every light-theme style rule keys off `data-theme`, not `prefers-color-scheme`, so the user's choice always wins.
- **Palette scope is honest.** It searches chat titles already loaded in the sidebar, says so in its footer, and runs only real actions.
