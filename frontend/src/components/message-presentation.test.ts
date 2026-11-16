/**
 * ============================================================================
 * FILE: message-presentation.test.ts
 * LOCATION: frontend/src/components/message-presentation.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify live placeholders and terminal assistant presentation rules.
 *
 * ROLE IN PROJECT:
 *    Exercises the approved presentation table in Node without React or DOM.
 *    Protects durable and user messages from live-only generating labels.
 *
 * KEY COMPONENTS:
 *    - Empty versus non-empty live assistant cases
 *    - Terminal status, live precedence, and user-message cases
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { VisibleMessage } from '../api/protocol.ts';
import { getMessagePresentation } from './message-presentation.ts';

const message: VisibleMessage = {
  messageId: 'assistant_1',
  turnId: 'turn_1',
  eventId: 'event_1',
  sequence: 2,
  role: 'assistant',
  content: '',
  createdAt: '2026-10-08T00:00:00Z',
  completionStatus: 'streaming',
  truncated: false,
};

describe('getMessagePresentation', () => {
  it.each(['submitting', 'accepted', 'generating', 'streaming'])(
    'shows the generating class for empty live %s only',
    (status) => {
      expect(getMessagePresentation(message, status)).toEqual({
        generatingClassName: 'aurvin-generating-placeholder',
        terminalStatus: null,
      });
      for (const content of ['H', ' ', '\n', '**Hello**']) {
        expect(getMessagePresentation({ ...message, content }, status)).toEqual({
          generatingClassName: null,
          terminalStatus: null,
        });
      }
    },
  );

  it.each(['finalizing', 'completed', 'idle', 'unknown'])(
    'shows neither placeholder nor badge for %s',
    (status) => {
      for (const content of ['', 'Answer']) {
        expect(getMessagePresentation({ ...message, content }, status)).toEqual({
          generatingClassName: null,
          terminalStatus: null,
        });
      }
    },
  );

  it.each(['truncated', 'cancelled', 'failed', 'interrupted'] as const)(
    'preserves terminal %s for live and durable messages',
    (status) => {
      for (const content of ['', 'Partial answer']) {
        const durable = { ...message, content, completionStatus: status };
        const expected = { generatingClassName: null, terminalStatus: status };
        expect(getMessagePresentation(durable)).toEqual(expected);
        expect(getMessagePresentation({ ...message, content }, status)).toEqual(expected);
      }
    },
  );

  it.each(['accepted', 'streaming', 'completed'] as const)(
    'never shows a generating placeholder on durable %s',
    (completionStatus) => {
      expect(getMessagePresentation({ ...message, completionStatus })).toEqual({
        generatingClassName: null,
        terminalStatus: null,
      });
    },
  );

  it('uses live status rather than a stale durable terminal status', () => {
    expect(getMessagePresentation(
      { ...message, completionStatus: 'truncated' }, 'finalizing',
    )).toEqual({ generatingClassName: null, terminalStatus: null });
  });

  it.each(['accepted', 'generating', 'streaming', 'finalizing', 'cancelled', 'failed'])(
    'does not decorate a user message with %s',
    (status) => {
      expect(getMessagePresentation({ ...message, role: 'user' }, status)).toEqual({
        generatingClassName: null,
        terminalStatus: null,
      });
    },
  );
});
