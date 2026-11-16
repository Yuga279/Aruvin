# FE-01 App shell: verification (16 November 2026, Node 24.21.0)

| Check | Result |
| --- | --- |
| `npm run build` (frontend) | Pass. Bundle-size warning existed before this release. |
| `npm run lint` (frontend) | 0 errors, 97 warnings. Baseline was 96; the extra one is `only-export-components` on the `useTheme` hook in `ThemeProvider.tsx`. |
| `npm test` (frontend) | 844 passed in 102 files (baseline 782 in 97). No tests removed. |
| Visual check | 24 screenshots: login, empty chat, conversation, palette, profile menu, Manage Aurvin, phone drawer; dark and light; 1280/900/390 px. No unexpected API calls and no page exceptions. Palette took focus on open and closed on Esc. |

## Not verified

- A live backend with WorkOS
- Real voice
- Browser end-to-end suites
- Screen readers
