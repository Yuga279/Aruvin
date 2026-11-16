# FE-02 Design system: goal

Give Aurvin one visual language: tokens for colour, radius, spacing, type, motion and elevation in both themes, plus small, accessible building blocks for new screens.

## In scope (Release 0)

- `styles/tokens.css`, with dark as the default and light under `data-theme`
- WCAG contrast enforced by tests
- `ui/` primitives: Button, IconButton, Badge, Card, Skeleton, Kbd, ErrorState
- The shared `useDialogFocusTrap` hook

## Out of scope

Select, Dropdown, Drawer, Tabs, Toast and Tooltip. Each gets built when its first real consumer appears; existing menus and tabs already work with native elements. Tailwind and shadcn/ui are deferred (see [target-state](../../architecture/target-state.md)).
