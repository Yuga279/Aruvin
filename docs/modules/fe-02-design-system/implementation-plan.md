# FE-02 Design system: implementation plan (as executed)

1. Defined the tokens and verified contrast with a test that computes WCAG ratios from `tokens.css`.
2. Built the `ui/` primitives and `ui.css`.
3. Extracted ConfirmDialog's focus trap into `useDialogFocusTrap`, keeping ConfirmDialog's markup identical so its existing tests stayed valid, and reused the hook in the command palette.
4. After the repository-wide Aurvin rename, removed the now-redundant legacy alias test and added a guard: every `var(--aurvin-*)` reference must have a definition. A temporary stylesheet with an undefined variable was used to confirm the guard fails, and was then deleted.
