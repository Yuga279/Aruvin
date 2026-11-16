# FE-01 App shell: implementation plan (as executed)

1. Recorded the baseline: frontend build, lint and tests on Node 24.21.0.
2. Added the theme logic (`app/theme/theme.ts`) and `ThemeProvider`; applied the saved theme in `main.tsx`.
3. Converted every OS-only light-theme block (`index.css`, `chat.css`, `scrollbars.css`, `confirm-dialog.css`) to `data-theme` selectors. Non-root rules use a zero-specificity `:where(:root[data-theme='light'])` prefix so source order still decides which rule wins.
4. Added brand constants (`app/brand.ts`) and the temporary `BrandMark`; replaced the logo images and user-visible product names.
5. Added the navigation model and feature flags; wired the sidebar Workspace section and Search entry.
6. Added the command palette, with its pure logic in `components/command-palette.ts`, mounted from `ChatView`.
7. Updated the tests that pinned old brand strings, added new tests, and ran build, lint and tests.
8. Visual check: 24 headless-Chrome screenshots covering both themes, desktop/tablet/phone widths, login, drawer, palette, profile menu and Manage Aurvin.
