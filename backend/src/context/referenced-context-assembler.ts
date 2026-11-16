/**
 * ============================================================================
 * FILE: referenced-context-assembler.ts
 * LOCATION: backend/src/context/referenced-context-assembler.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assemble versioned current-session context from fixed assets and message refs.
 *
 * ROLE IN PROJECT:
 *    Implements P1's ContextAssembler using read-only memory/message ports and
 *    returns either ordered model messages or a deterministic overflow result.
 *
 * KEY COMPONENTS:
 *    - ReferencedContextAssembler: Fixed pair, mode selector, eligible history, one input.
 *    - ContextDependencies: Injected budgets, frozen assets, and get-only ports.
 * ============================================================================
 */

import { budgetConfigSchema, type BudgetConfig } from '../contracts/budgets.js';
import type { AssembledContext, ContextAssembler, ContextAssemblyRequest, ContextAssemblyResult, ContextChatMessage,
  ContextSourceSnapshot } from '../contracts/context.js';
import { idSchema } from '../contracts/identifiers.js';
import type { MessageRecord } from '../contracts/message.js';
import type { MessageRef } from '../contracts/agent-memory.js';
import type { AgentMemoryRepository, MessageRepository } from '../contracts/repositories.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../contracts/voice.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import { AppError } from '../platform/errors/app-error.js';
import { assertFixedContextFits, checkContextBudget, environmentContextMessage, estimatePromptTokens, fixedContextMessages, responseModeMessage, validateInput }
  from './context-budget.js';
import { selectReferences, validateManifest } from './reference-selection.js';

export type PositionedContext = AssembledContext & {
  historyPositions: readonly { messageId: string; turnId: string; role: 'user' | 'assistant'; index: number }[];
};

export type ContextDependencies = {
  memory: Pick<AgentMemoryRepository, 'get'>;
  messages: Pick<MessageRepository, 'get'> & {
    getReferences?(userId: string, sessionId: string, refs: readonly MessageRef[]): Promise<MessageRecord[]>;
  };
  metadata?: {
    getVoiceDelivery(userId: string, sessionId: string, attemptId: string): Promise<VoiceDeliveryRecord | null>;
    getVoiceDeliveries?(userId: string, sessionId: string, attemptIds: readonly string[]): Promise<VoiceDeliveryRecord[]>;
  };
  budgets: BudgetConfig;
  assets: FixedAssets;
};

export class ReferencedContextAssembler implements ContextAssembler {
  private readonly budgets: BudgetConfig;
  private readonly assets: FixedAssets;
  constructor(private readonly dependencies: ContextDependencies) {
    const parsed = budgetConfigSchema.safeParse(dependencies.budgets);
    if (!parsed.success) throw new AppError('CONFIGURATION_ERROR', 'Invalid context budget configuration.');
    this.budgets = Object.freeze(parsed.data);
    this.assets = Object.freeze({ ...dependencies.assets });
    assertFixedContextFits(this.assets, this.budgets);
  }
  forBudgets(budgets: BudgetConfig): ContextAssembler {
    return new ReferencedContextAssembler({ ...this.dependencies, budgets });
  }
  private fixedMessages(): ContextChatMessage[] {
    return fixedContextMessages(this.assets);
  }
  private async heardMessage(record: MessageRecord, deliveries?: ReadonlyMap<string, VoiceDeliveryRecord>): Promise<ContextChatMessage | null> {
    if (record.role !== 'assistant' || record.visibility !== 'internal' || record.mode !== 'live') {
      return { role: record.role, content: record.content };
    }
    const reader = this.dependencies.metadata;
    if (!reader || !record.attemptId) throw new AppError('NOT_READY', 'Voice delivery needs reconciliation.');
    const raw = deliveries ? deliveries.get(record.attemptId)
      : await reader.getVoiceDelivery(record.userId, record.sessionId, record.attemptId);
    const parsed = voiceDeliveryRecordSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.userId !== record.userId ||
      parsed.data.sessionId !== record.sessionId ||
      parsed.data.turnId !== record.turnId ||
      parsed.data.attemptId !== record.attemptId ||
      parsed.data.textGenerated !== record.content ||
      parsed.data.status === 'pending'
    ) {
      throw new AppError('NOT_READY', 'Voice delivery needs reconciliation.');
    }
    const delivery = parsed.data;
    const recordArtifacts = record.canvasArtifacts ?? [];
    const deliveryArtifacts = delivery.canvasArtifacts ?? [];
    if (
      recordArtifacts.length !== deliveryArtifacts.length ||
      JSON.stringify(recordArtifacts) !== JSON.stringify(deliveryArtifacts)
    ) {
      throw new AppError('NOT_READY', 'Voice delivery needs reconciliation.');
    }
    const content =
      delivery.status === 'unknown' || delivery.textSpoken === null
        ? 'Voice reply delivery is unknown; do not assume generated content was heard.'
        : delivery.textSpoken;
    return content === '' ? null : { role: 'assistant', content };
  }
  async assemble(request: ContextAssemblyRequest, source?: ContextSourceSnapshot): Promise<ContextAssemblyResult> {
    for (const id of [request.userId, request.sessionId, request.turnId]) {
      if (!idSchema.safeParse(id).success) throw new AppError('INVALID_REQUEST', 'Invalid chat identity.');
    }
    validateInput(request.newUserInput, this.budgets);
    const raw = source?.manifest ?? await this.dependencies.memory.get(request.userId, request.sessionId);
    if (!raw) throw new AppError('NOT_READY', 'Chat context needs reconciliation before continuing.');
    const manifest = validateManifest(raw, request, this.assets, this.budgets);
    const refs = [...manifest.messageRefs].sort((a, b) => a.sequence - b.sequence);
    const records = source ? [...source.records] : this.dependencies.messages.getReferences
      ? await this.dependencies.messages.getReferences(request.userId, request.sessionId, refs) : [];
    for (const ref of source || this.dependencies.messages.getReferences ? [] : refs) {
      const record = await this.dependencies.messages.get(request.userId, request.sessionId, ref.messageId);
      if (!record) throw new AppError('NOT_READY', 'Chat context needs reconciliation before continuing.');
      records.push(record);
    }
    const history = selectReferences(request, manifest, records, this.assets, this.budgets);
    const deliveryIds = history.filter(record => record.role === 'assistant' && record.visibility === 'internal'
      && record.mode === 'live' && record.attemptId).map(record => record.attemptId!);
    const bulk = this.dependencies.metadata?.getVoiceDeliveries?.bind(this.dependencies.metadata);
    const deliveries = bulk ? new Map((await bulk(request.userId, request.sessionId, deliveryIds))
      .map(delivery => [delivery.attemptId, delivery])) : undefined;
    const prefix: ContextChatMessage[] = [...this.fixedMessages(), environmentContextMessage(request.environment),
      responseModeMessage(request.responseMode)];
    const historyPositions: PositionedContext['historyPositions'][number][] = [];
    const heardHistory: ContextChatMessage[] = [];
    for (const record of history) {
      const message = await this.heardMessage(record, deliveries);
      if (message) {
        historyPositions.push({ messageId: record.messageId, turnId: record.turnId,
          role: record.role, index: prefix.length + heardHistory.length });
        heardHistory.push(message);
      }
      if (record.role === 'assistant' && record.visibility === 'internal' && record.mode === 'live' && record.canvasArtifacts?.length) {
        heardHistory.push({
          role: 'assistant',
          content:
            'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
            JSON.stringify({
              messageId: record.messageId,
              turnId: record.turnId,
              artifacts: record.canvasArtifacts,
            }),
        });
      }
    }
    const messages: ContextChatMessage[] = [
      ...prefix,
      ...heardHistory,
      { role: 'user', content: request.newUserInput },
    ];
    const overflow = checkContextBudget(messages, this.budgets);
    if (overflow) return { ok: false, overflow };
    if (messages.some(m => Buffer.byteLength(m.content, 'utf8') > this.budgets.maxMessageBytes)) {
      const requiredTokens = estimatePromptTokens(messages) + this.budgets.maxOutputTokens + this.budgets.modelMarginTokens;
      return {
        ok: false,
        overflow: {
          code: 'CONTEXT_BUDGET_EXCEEDED',
          message: 'This chat has reached its context limit. Start a new chat to continue.',
          maxContextTokens: this.budgets.maxContextTokens,
          requiredTokens,
        },
      };
    }
    const context: PositionedContext = {
      contextVersion: manifest.contextVersion, instructionVersion: this.assets.instructionVersion,
      knowledgeContentHash: this.assets.knowledgeContentHash, graphSchemaVersion: this.assets.graphSchemaVersion,
      messages, historyPositions,
    };
    return { ok: true, context };
  }
}
