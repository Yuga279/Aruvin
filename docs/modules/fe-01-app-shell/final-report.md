# FE-01 App shell: final report

See [Release 0 notes](../../releases/release-0.md) for the combined list of files changed.

- **Implemented:** branding, theme switch, flag-aware navigation, command palette.
- **Reused:** the existing layout, drawer and breakpoints; `onManageAlfred` and `onOpenCalendarSetup` navigation; the session list; ConfirmDialog focus behaviour, extracted into `useDialogFocusTrap`.
- **Database and API changes:** none.

## Known limitations

- The emblem is temporary until the official Aurvin logo files are supplied. Replace `components/BrandMark.tsx` and `public/aurvin-mark.svg`.
- The palette's "Ctrl K" hint isn't adapted for macOS, although Cmd+K works.
- There's no URL router, so the browser Back button doesn't move between chat and admin.
- The default theme is applied in `main.tsx`, so a stored Light preference can flash dark briefly on slow loads. An inline pre-paint script was avoided to keep a strict Content Security Policy possible later.

## Deployment

Nothing new beyond serving `public/aurvin-mark.svg`.

## Follow-ups

- Official logo files
- Phone bottom navigation once there are more real destinations
- A URL router when deep links are needed (likely Release 5)
