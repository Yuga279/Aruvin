/**
 * ============================================================================
 * FILE: command-palette.ts
 * LOCATION: frontend/src/components/command-palette.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Pure command palette logic: item model, filtering and shortcut.
 *
 * ROLE IN PROJECT:
 *    Kept apart from CommandPalette.tsx so the component file exports only
 *    components (fast refresh) and the logic stays unit-testable in Node.
 *
 * KEY COMPONENTS:
 *    - PaletteItem / PaletteGroup
 *    - filterPaletteItems: grouped, ranked, conversation-capped filtering
 *    - isPaletteShortcut: Ctrl/Cmd+K detection
 * ============================================================================
 */

export type PaletteGroup = 'Actions' | 'Theme' | 'Conversations';

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  run: () => void;
};

const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Conversations', 'Theme'];
export const PALETTE_CONVERSATION_LIMIT = 8;

/** Case-insensitive match on every whitespace-separated term; label prefix
 * matches rank first. Stable within a group. Conversations are capped. */
export function filterPaletteItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = items
    .map((item, index) => ({ item, index, text: `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase() }))
    .filter(({ text }) => terms.every((term) => text.includes(term)))
    .map((entry) => ({
      ...entry,
      rank: terms.length > 0 && entry.item.label.toLowerCase().startsWith(terms[0]) ? 0 : 1,
    }));
  const out: PaletteItem[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = matched
      .filter((entry) => entry.item.group === group)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.item);
    out.push(...(group === 'Conversations' ? inGroup.slice(0, PALETTE_CONVERSATION_LIMIT) : inGroup));
  }
  return out;
}

export function isPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  return event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}
