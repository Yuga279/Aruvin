/**
 * ============================================================================
 * FILE: runtime.ts
 * LOCATION: backend/src/contracts/runtime.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the model adapter and agent runtime orchestration interfaces.
 *
 * ROLE IN PROJECT:
 *    Separates provider streaming from application turn lifecycle behavior and
 *    requires a resolved OpenRouter user on every model invocation.
 *
 * KEY COMPONENTS:
 *    - ModelAdapter: Emits typed streaming and accounting chunks.
 *    - AgentRuntime: Accepts, retries, cancels, queries, and reconciles turns.
 * ============================================================================
 */

import type { SubmitTurnResponse, TurnStatusResponse } from './api.js';
import type { ContextChatMessage } from './context.js';
import type { ResolvedIdentity } from './identity.js';
import type { AccountingStatus } from './metadata.js';
import type { CalendarReplyReference } from './calendar-authority.js';

export type ChatMessage = ContextChatMessage;

export type ModelInvokeRequest = {
  modelId: string;
  user: string;
  messages: readonly ChatMessage[];
  maxOutputTokens: number;
  abortSignal: AbortSignal;
  transforms: readonly string[];
  dataCollection: 'allow' | 'deny';
};

export type ModelChunk =
  | { type: 'delta'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'generation-id'; generationId: string }
  | {
      type: 'usage';
      promptTokens: number | null;
      completionTokens: number | null;
      cost: number | null;
      accountingStatus: AccountingStatus;
    }
  | { type: 'length' }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'end' };

export interface ModelAdapter {
  stream(request: ModelInvokeRequest): AsyncIterable<ModelChunk>;
}

export type SubmitTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string | null;
  content: string;
  idempotencyKey: string;
  expectedEpoch?: string;
  calendarProtocol?: 2 | 3;
  /**
   * The bounded, untrusted proposal revision this reply answers. The runtime
   * binds it to the accepted attempt; it never authorises an effect by itself.
   */
  calendarReplyTo?: CalendarReplyReference;
};

export type RetryTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string;
  turnId: string;
  idempotencyKey: string;
  expectedEpoch?: string;
  calendarProtocol?: 2 | 3;
};

export type CancelTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string;
  turnId: string;
  attemptId: string;
};

export interface AgentRuntime {
  submitTurn(command: SubmitTurnCommand): Promise<SubmitTurnResponse>;
  cancelTurn(command: CancelTurnCommand): Promise<void>;
  retryTurn(command: RetryTurnCommand): Promise<SubmitTurnResponse>;
  getTurnStatus(
    userId: string,
    sessionId: string,
    turnId: string,
  ): Promise<TurnStatusResponse>;
  reconcileSession(userId: string, sessionId: string): Promise<void>;
}
