# FE-01 App shell: contracts

There are no API, database or wire changes in Release 0.

## Browser storage

| Key | Storage | Values |
| --- | --- | --- |
| `aurvin:theme` | `localStorage` | `dark`, `light` or `system`. Missing or unknown values mean `dark`. |

## DOM contract

`<html data-theme="dark|light">` is always set. `styles/tokens.css` defines the light overrides under `:root[data-theme='light']`.

## Component props added

| Component | Prop | Purpose |
| --- | --- | --- |
| `Sidebar` | `onOpenIntegrations` | Opens Manage Aurvin → Plugins |
| `Sidebar` | `onOpenCommandPalette` | Renders the Search entry |
| `CommandPalette` | `open`, `items: PaletteItem[]`, `onClose` | The palette dialog |
| `ThemeProvider` | `initialPreference` (optional) | For tests |

## Keyboard

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+K | Toggle the palette (chat page only) |
| Arrow Up / Arrow Down / Enter | Move through and run palette results |
| Esc | Close the palette and restore focus |

These don't collide with the voice shortcuts Alt+M, Alt+X, Alt+C or Escape (the palette handles Escape only while it's open).
