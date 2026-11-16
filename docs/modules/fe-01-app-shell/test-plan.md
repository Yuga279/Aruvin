# FE-01 App shell: test plan

| What | How | File |
| --- | --- | --- |
| Theme parse, resolve, persist; storage that throws; apply | Unit | `app/theme/theme.test.ts` |
| Only working destinations shown; flags; member role hides Settings | Unit + server render | `app/navigation.test.ts`, `components/Sidebar.test.ts` |
| Palette filtering, ranking, conversation cap; Ctrl/Cmd+K only; combobox/listbox markup | Unit + server render | `components/CommandPalette.test.ts` |
| Brand mark and tagline on welcome; brand strings on auth and admin screens | Server render | `EmptyState`, `Sidebar`, `auth-forms`, `admin-dashboard` tests |
| No OS-only light styling anywhere | Static CSS scan | `styles/tokens.test.ts` |
| Existing chat, voice, canvas, admin and auth behaviour unchanged | Existing suites | All 97 pre-existing test files |
| Layout and both themes at 1280, 900 and 390 px | Headless Chrome screenshots against the auth fixture API | Manual harness (not committed) |

Not covered: real-browser keyboard and focus tests (the repo's tests run in Node without a DOM), and screen-reader passes.
