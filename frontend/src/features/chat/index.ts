/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: frontend/src/features/chat/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public barrel for P9 application assembly and P10 integration tests.
 *
 * ROLE IN PROJECT:
 *    Exposes ChatView, ChatProvider, client factory, and state types without
 *    leaking markdown internals or reducer implementation details.
 *
 * KEY COMPONENTS:
 *    - ChatView / ChatProvider / useChat
 *    - ApiClient / createApiClient
 *    - ChatState / ChatAction types
 * ============================================================================
 */

import '../../styles/chat.css';

export { ApiClient, createApiClient } from '../../api/client.ts';
export { ChatView } from './ChatView.tsx';
export { ChatProvider, useChat } from './state/chat-context.tsx';
export type { ChatAction, ChatState } from './state/chat-types.ts';
