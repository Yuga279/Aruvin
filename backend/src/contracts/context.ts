/**
 * ============================================================================
 * FILE: context.ts
 * LOCATION: backend/src/contracts/context.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define context assembly inputs, outputs, and explicit overflow results.
 *
 * ROLE IN PROJECT:
 *    Establishes the interface between future context selection and runtime
 *    orchestration without implementing compaction or history retrieval here.
 *
 * KEY COMPONENTS:
 *    - Context assembly types: Include versioned ordered chat messages.
 *    - ContextAssembler: Returns selected context or a budget overflow result.
 * ============================================================================
 */

import type { AgentMemoryManifest } from './agent-memory.js';
import type { MessageRecord } from './message.js';
export type ResponseMode = 'text' | 'voice';

export type EnvironmentContext = {
  timeZone: string;
  currentDate: string;
  dayOfWeek?: string;
};

/** Internal, request-local source reuse only. The owning runtime must verify
 * the manifest under its lease before reuse; assembly still validates all refs
 * and reprojects time-sensitive Calendar/voice evidence. Never a wire input. */
export type ContextSourceSnapshot = {
  manifest: AgentMemoryManifest;
  records: readonly MessageRecord[];
};

export type ContextChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ContextOverflow = {
  code: 'CONTEXT_BUDGET_EXCEEDED';
  message: string;
  maxContextTokens: number;
  requiredTokens: number;
};

export type AssembledContext = {
  contextVersion: number;
  instructionVersion: string;
  knowledgeContentHash: string;
  graphSchemaVersion: string;
  messages: readonly ContextChatMessage[];
};

export type ContextAssemblyResult =
  | { ok: true; context: AssembledContext }
  | { ok: false; overflow: ContextOverflow };

export type ContextAssemblyRequest = {
  userId: string;
  sessionId: string;
  turnId: string;
  newUserInput: string;
  responseMode: ResponseMode;
  environment?: EnvironmentContext;
};

export interface ContextAssembler {
  assemble(request: ContextAssemblyRequest, source?: ContextSourceSnapshot): Promise<ContextAssemblyResult>;
}
