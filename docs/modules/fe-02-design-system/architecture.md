# FE-02 Design system: architecture

- **Tokens** are CSS custom properties on `:root` (dark), overridden under `:root[data-theme='light']`. `index.css` imports `styles/tokens.css` first, so every entry point gets them, including the development browser fixtures.
- **Primitives** in `ui/` are native elements with `aurvin-` classes styled in `ui/ui.css`, using tokens only. There's no headless-UI dependency.
- **Shell styles** for brand, sidebar links, theme switch and palette live in `styles/shell.css`.
- **Legacy styles.** The 2,400-line `chat.css` and the feature stylesheets reference tokens directly since the Aurvin rename. They aren't rewritten in this release, apart from the light-theme conversion, the composer focus ring and a few shadow and overlay tokens.

## Contrast decisions

White text on the dark-theme primary `#7485FF` measures about 3.2:1, which fails WCAG AA. Text on primary-coloured fills therefore uses `--aurvin-on-primary` (`#0B0E14` in dark, about 6:1).

Light-theme status colours were darkened from the first proposal so they pass 4.5:1 on white:

| Token | Light value |
| --- | --- |
| success | `#137A59` |
| warning | `#92600F` |
| danger | `#C2343F` |
| secondary | `#6E4FE6` |
