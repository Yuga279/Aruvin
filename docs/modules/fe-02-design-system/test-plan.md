# FE-02 Design system: test plan

| What | File |
| --- | --- |
| 17 text/background pairs reach at least 4.5:1 in each theme; focus ring at least 3:1 on every surface; the specified dark brand values; no white text on the dark primary | `styles/tokens.test.ts` |
| Every `var(--aurvin-*)` reference is defined; no `prefers-color-scheme` left in any stylesheet | `styles/tokens.test.ts` |
| Primitive defaults (button type, accessible names, `role="alert"`, `aria-hidden` skeleton) | `ui/ui.test.ts` |
| ConfirmDialog behaviour unchanged | `components/ConfirmDialog.test.ts` (existing) |
