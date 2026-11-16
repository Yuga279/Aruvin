/**
 * ============================================================================
 * FILE: dictation-draft.test.ts
 * LOCATION: frontend/src/features/voice/dictation/dictation-draft.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for immutable selection snapshots and bounded draft composition.
 *
 * ROLE IN PROJECT:
 *    Verifies selection replacement, interim/final segment deduplication,
 *    empty recording preservation, whitespace/punctuation handling, and draft bounds.
 *
 * KEY COMPONENTS:
 *    - DictationDraft test suite
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { DictationDraft, snapshotDraft } from './dictation-draft.ts';

it('replaces only the selected range and replaces revised interim hypotheses', () => {
  const snapshot = snapshotDraft('Before OLD after', 7, 10, 'backward');
  expect(snapshot).toMatchObject({ prefix: 'Before ', suffix: ' after', selectedText: 'OLD',
    selection: { start: 7, end: 10, direction: 'backward' } });
  const draft = new DictationDraft(snapshot);
  draft.accept('dictation.partial', 'one', 'new');
  expect(draft.text()).toBe('Before new after');
  draft.accept('dictation.partial', 'one', 'new words');
  expect(draft.text()).toBe('Before new words after');
  draft.accept('dictation.final', 'one', 'New words.');
  draft.accept('dictation.final', 'one', 'New words.');
  draft.accept('dictation.partial', 'one', 'obsolete');
  draft.accept('dictation.partial', 'two', 'more');
  expect(draft.text()).toBe('Before New words. more after');
  expect(draft.text(false)).toBe('Before New words. after');
  draft.accept('dictation.final', 'two', 'New words.');
  expect(draft.text(false)).toBe('Before New words. New words. after');
});

it('keeps empty recordings and the selected text unchanged', () => {
  const draft = new DictationDraft(snapshotDraft('Keep selected text', 5, 13));
  expect(draft.text(false)).toBe('Keep selected text');
  draft.accept('dictation.partial', 'one', '');
  draft.accept('dictation.final', 'one', '');
  expect(draft.text()).toBe('Keep selected text');
  expect(draft.caret()).toEqual({ start: 5, end: 13, direction: 'none' });
});

it('preserves meaning, supplied whitespace, punctuation and UTF-16 caret positions', () => {
  const draft = new DictationDraft(snapshotDraft('🙂 [] end', 4, 4));
  draft.accept('dictation.final', 'one', 'ID AB-123, not 2026-10-09');
  draft.accept('dictation.final', 'two', '.');
  draft.accept('dictation.final', 'three', '  No, no.');
  expect(draft.text()).toBe('🙂 [ID AB-123, not 2026-10-09.  No, no.] end');
  expect(draft.caret().start).toBe(4 + 'ID AB-123, not 2026-10-09.  No, no.'.length);
});

it('rejects overflow without truncating the last accepted final or unrelated text', () => {
  const draft = new DictationDraft(snapshotDraft('x'.repeat(31_996), 31_996, 31_996));
  draft.accept('dictation.final', 'one', 'OK');
  expect(() => draft.accept('dictation.partial', 'two', 'overflow')).toThrow('DICTATION_DRAFT_LIMIT');
  expect(draft.text(false)).toBe('x'.repeat(31_996) + 'OK');
  expect(() => snapshotDraft('x'.repeat(32_001), 0, 0)).toThrow('DICTATION_DRAFT_LIMIT');
});

it('bounds remembered final IDs even when the provider returns empty segments', () => {
  const draft = new DictationDraft(snapshotDraft('Keep me', 0, 4));
  for (let i = 0; i < 4096; i++) draft.accept('dictation.final', `empty-${i}`, '');
  expect(() => draft.accept('dictation.final', 'overflow', '')).toThrow('DICTATION_DRAFT_LIMIT');
  expect(draft.text()).toBe('Keep me');
});
