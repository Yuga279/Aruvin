/**
 * ============================================================================
 * FILE: message-presentation.ts
 * LOCATION: frontend/src/components/message-presentation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Select live generating placeholders and after-content terminal statuses.
 *
 * ROLE IN PROJECT:
 *    Keeps MessageItem presentation rules pure and testable in Node.
 *    Does not alter lifecycle state, submission locks, or transport contracts.
 *
 * KEY COMPONENTS:
 *    - getMessagePresentation: Live-only placeholder and terminal selection
 * ============================================================================
 */

import type { VisibleMessage } from '../api/protocol.ts';

export function getMessagePresentation(message: VisibleMessage, liveStatus?: string) {
  const status = liveStatus ?? message.completionStatus;
  const isAssistant = message.role === 'assistant';
  const showGenerating = isAssistant && liveStatus !== undefined &&
    message.content.length === 0 &&
    ['submitting', 'accepted', 'generating', 'streaming'].includes(status);

  return {
    generatingClassName: showGenerating ? 'aurvin-generating-placeholder' : null,
    terminalStatus: isAssistant &&
      ['truncated', 'cancelled', 'failed', 'interrupted'].includes(status)
      ? status : null,
  };
}
