/**
 * ============================================================================
 * FILE: CommandPalette.tsx
 * LOCATION: frontend/src/components/CommandPalette.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Keyboard-first command palette (Ctrl/Cmd+K) for the Aurvin shell.
 *
 * ROLE IN PROJECT:
 *    Mounted by ChatView. Offers only actions backed by working code: new
 *    chat, Integrations, Settings, theme switching, and jumping to a chat
 *    by title among the conversations already loaded in the sidebar (not a
 *    server-side search; full search is Release 1).
 *
 * KEY COMPONENTS:
 *    - CommandPalette: combobox + listbox dialog with focus trap
 *    - Filtering and shortcut logic live in command-palette.ts
 * ============================================================================
 */

import { useId, useMemo, useRef, useState } from 'react';
import { useDialogFocusTrap } from '../ui/Dialog.tsx';
import { Kbd } from '../ui/primitives.tsx';
import { IconSearch } from './icons.tsx';
import { filterPaletteItems, type PaletteItem } from './command-palette.ts';
import '../styles/shell.css';

export function CommandPalette({ open, items, onClose }: { open: boolean; items: readonly PaletteItem[]; onClose: () => void }) {
  if (!open) return null;
  return <PaletteDialog items={items} onClose={onClose} />;
}

function PaletteDialog({ items, onClose }: { items: readonly PaletteItem[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ids = useId();
  const listId = `${ids}-list`;
  const results = useMemo(() => filterPaletteItems(items, query), [items, query]);
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  useDialogFocusTrap(dialogRef, { open: true, onEscape: onClose, initialFocusRef: inputRef });

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="aurvin-palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className="aurvin-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="aurvin-palette-search">
          <IconSearch />
          <input
            ref={inputRef}
            className="aurvin-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? `${ids}-opt-${activeIndex}` : undefined}
            aria-label="Search commands and loaded chats"
            placeholder="Search commands and chats…"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((activeIndex + 1) % Math.max(results.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((activeIndex - 1 + results.length) % Math.max(results.length, 1));
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                run(results[activeIndex]);
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id={listId} className="aurvin-palette-list" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <li className="aurvin-palette-empty" role="presentation">No matching commands or loaded chats.</li>
          ) : null}
          {results.map((item, index) => {
            const heading = index === 0 || results[index - 1].group !== item.group ? item.group : null;
            return [
              heading ? (
                <li key={`h-${heading}`} className="aurvin-palette-group" role="presentation">{heading}</li>
              ) : null,
              <li
                key={item.id}
                id={`${ids}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className="aurvin-palette-option"
                onMouseMove={() => { if (index !== activeIndex) setActive(index); }}
                onClick={() => run(item)}
              >
                <span className="aurvin-palette-label">{item.label}</span>
                {item.hint ? <span className="aurvin-palette-hint">{item.hint}</span> : null}
              </li>,
            ];
          })}
        </ul>
        <p className="aurvin-palette-footer">Chats are searched by title among those loaded in the sidebar.</p>
      </div>
    </div>
  );
}
