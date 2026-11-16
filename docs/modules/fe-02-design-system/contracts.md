# FE-02 Design system: contracts

## Colour tokens (`--aurvin-*`)

| Token | Dark | Light |
| --- | --- | --- |
| bg | `#0B0E14` | `#F7F8FB` |
| surface | `#111722` | `#FFFFFF` |
| surface-elevated | `#1A2230` | `#FFFFFF` |
| primary / primary-hover | `#7485FF` / `#8B99FF` | `#4F5FE8` / `#4352D6` |
| on-primary | `#0B0E14` | `#FFFFFF` |
| secondary | `#9B7BFF` | `#6E4FE6` |
| success / warning / danger | `#35C99A` / `#E9B75C` / `#F07178` | `#137A59` / `#92600F` / `#C2343F` |
| text-primary / text-secondary | `#F4F6FA` / `#A0A9B8` | `#0F1420` / `#5B6475` |
| border / border-strong | white at 8% / 14% | ink at 10% / 16% |

There are also hover, selected, user-bubble, code-bg, disabled, overlay, gradient-brand and shadow (sm/md/lg/composer) tokens.

## Non-colour tokens

| Group | Values |
| --- | --- |
| Radius | sm 8, md 12, lg 18, full 999 (px) |
| Spacing | 4, 8, 12, 16, 20, 24, 32 px |
| Type | xs 12, sm 13, md 14, base 16, lg 20, xl 28 (px); system font stack |
| Motion | fast 120 ms, base 200 ms, slow 320 ms; `--aurvin-ease` |
| Layers | drawer 30, canvas overlay 40, dialog 100 |

## Primitive APIs (`ui/index.ts`)

| Primitive | API |
| --- | --- |
| Button | `variant` (primary, secondary, ghost, danger), `size` (sm, md); defaults to `type="button"` |
| IconButton | Requires `label`, which becomes the accessible name |
| Badge | `tone` (neutral, primary, success, warning, danger) |
| Card, Skeleton, Kbd | Presentational; Skeleton is `aria-hidden` |
| ErrorState | `role="alert"`; the action renders only when a handler is passed |
| useDialogFocusTrap | Handles Tab cycling, Escape and initial focus; restores focus on close (opt-out) |
