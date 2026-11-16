/**
 * ============================================================================
 * FILE: ChatView.test.ts
 * LOCATION: frontend/src/features/chat/ChatView.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Confirm ChatView exports a React function component.
 *
 * ROLE IN PROJECT:
 *    Node-environment smoke check for the assembled chat feature view.
 *
 * KEY COMPONENTS:
 *    - Export type assertion
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { ChatView } from './ChatView.tsx';

describe('ChatView component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof ChatView).toBe('function');
  });
});
