/**
 * ============================================================================
 * FILE: dictation-draft.ts
 * LOCATION: frontend/src/features/voice/dictation/dictation-draft.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Immutable selection snapshotting and bounded transcript composition model.
 *
 * ROLE IN PROJECT:
 *    Manages prefix/suffix text preservation, replacement of selected text with
 *    final and interim recognized segments, and caret computation.
 *
 * KEY COMPONENTS:
 *    - MAX_DICTATION_DRAFT_CHARS: Maximum allowed draft length (32,000)
 *    - snapshotDraft: Captures immutable snapshot of draft and selection
 *    - DictationDraft: Composes partial and final transcription segments
 * ============================================================================
 */

export const MAX_DICTATION_DRAFT_CHARS = 32_000;
export type DraftSelection = { readonly start: number; readonly end: number;
  readonly direction: 'forward' | 'backward' | 'none' };
export type DraftSnapshot = { readonly original: string; readonly prefix: string; readonly suffix: string;
  readonly selectedText: string; readonly selection: DraftSelection };

export function snapshotDraft(original: string, start: number, end: number,
  direction: DraftSelection['direction'] = 'none'): DraftSnapshot {
  if (original.length > MAX_DICTATION_DRAFT_CHARS) throw new Error('DICTATION_DRAFT_LIMIT');
  const clamp = (value: number) => Number.isFinite(value)
    ? Math.max(0, Math.min(original.length, Math.trunc(value))) : original.length;
  const a = clamp(start), b = clamp(end);
  const selection = { start: Math.min(a, b), end: Math.max(a, b), direction };
  return { original, prefix: original.slice(0, selection.start), suffix: original.slice(selection.end),
    selectedText: original.slice(selection.start, selection.end), selection };
}

function joinSegments(parts: string[]) {
  return parts.reduce((text, part) => text +
    (text && part && !/\s$/.test(text) && !/^[\s.,!?;:)\]}]/.test(part) ? ' ' : '') + part, '');
}

export class DictationDraft {
  readonly snapshot: DraftSnapshot;
  private finals = new Map<string, string>();
  private interim: { id: string; text: string } | null = null;
  constructor(snapshot: DraftSnapshot) { this.snapshot = snapshot; }
  private inserted(includeInterim: boolean) {
    // ponytail: rebuild at most 32k characters / 4096 segments; no transcript archive here.
    return joinSegments([...this.finals.values()].filter(Boolean)
      .concat(includeInterim && this.interim ? [this.interim.text] : []));
  }
  private compose(inserted: string) {
    return inserted ? this.snapshot.prefix + inserted + this.snapshot.suffix : this.snapshot.original;
  }
  accept(type: 'dictation.partial' | 'dictation.final', id: string, text: string) {
    if (this.finals.has(id)) return;
    const oldInterim = this.interim;
    if (type === 'dictation.final') {
      if (this.finals.size >= 4096) throw new Error('DICTATION_DRAFT_LIMIT');
      this.finals.set(id, text.trim() ? text : '');
      if (this.interim?.id === id) this.interim = null;
    } else this.interim = text.trim() ? { id, text } : null;
    if (this.text().length > MAX_DICTATION_DRAFT_CHARS) {
      if (type === 'dictation.final') this.finals.delete(id);
      this.interim = oldInterim;
      throw new Error('DICTATION_DRAFT_LIMIT');
    }
  }
  text(includeInterim = true) { return this.compose(this.inserted(includeInterim)); }
  caret(): DraftSelection {
    const inserted = this.inserted(false);
    if (!inserted) return this.snapshot.selection;
    const end = this.snapshot.prefix.length + inserted.length;
    return { start: end, end, direction: 'none' };
  }
}
