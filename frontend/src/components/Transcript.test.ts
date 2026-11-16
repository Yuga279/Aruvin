/**
 * ============================================================================
 * FILE: Transcript.test.ts
 * LOCATION: frontend/src/components/Transcript.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Confirm transcript exports and context-independent safe historical rows.
 *
 * ROLE IN PROJECT:
 *    Node-environment smoke check for transcript rendering modules.
 *
 * KEY COMPONENTS:
 *    - Export type assertions
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { MessageItem } from './MessageItem.tsx';
import { Transcript } from './Transcript.tsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('Transcript and MessageItem components', () => {
  it('exports valid React components', () => {
    expect(typeof Transcript).toBe('function');
    expect(MessageItem).toMatchObject({ $$typeof: Symbol.for('react.memo') });
  });
  it('renders an immutable historical row without subscribing to the broad chat context', () => {
    const html = renderToStaticMarkup(createElement(MessageItem, { message: {
      messageId: 'm1', turnId: 't1', eventId: 'e1', sequence: 1, role: 'assistant',
      content: '**Archive** [unsafe](javascript:alert(1))', createdAt: '', completionStatus: 'completed', truncated: false,
    } }));
    expect(html).toContain('<strong>Archive</strong>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Copy response');
  });
});
