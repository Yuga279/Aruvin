/**
 * ============================================================================
 * FILE: reference-selection.ts
 * LOCATION: backend/src/context/reference-selection.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate scoped manifests and select eligible original message records.
 *
 * ROLE IN PROJECT:
 *    Pure reference selection restores current-session history without copying
 *    transcripts, compacting, or discovering archive records beyond published refs.
 *
 * KEY COMPONENTS:
 *    - validateManifest: Scope, version, summary-null, and range-envelope checks.
 *    - selectReferences: Eligible history with exactly-once current-turn input.
 *    - buildReferenceManifest: Reference-only construction for later finalization.
 * ============================================================================
 */

import { agentMemoryManifestSchema, type AgentMemoryManifest, type MessageRef } from '../contracts/agent-memory.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { ContextAssemblyRequest } from '../contracts/context.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import { AppError } from '../platform/errors/app-error.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import { validateMessageBytes } from './context-budget.js';

function inconsistent(): never {
  throw new AppError('NOT_READY', 'Chat context needs reconciliation before continuing.');
}
function assertBytes(manifest: AgentMemoryManifest, budgets: BudgetConfig): void {
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > budgets.maxManifestBytes) {
    throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its storage limit. Start a new chat.');
  }
}
function validateReferences(manifest: AgentMemoryManifest): MessageRef[] {
  const refs = [...manifest.messageRefs].sort((a, b) => a.sequence - b.sequence);
  for (const key of ['messageId', 'eventId', 'sequence'] as const) {
    if (new Set(refs.map((ref) => ref[key])).size !== refs.length) inconsistent();
  }
  // Phase 1 selects all references. One envelope names the first/last events;
  // explicit refs, not every sequence in the envelope, define membership.
  const expected = refs.length ? [{ fromSequence: refs[0].sequence,
    toSequence: refs.at(-1)!.sequence, fromEventId: refs[0].eventId,
    toEventId: refs.at(-1)!.eventId }] : [];
  if (JSON.stringify(manifest.sourceRanges) !== JSON.stringify(expected)) inconsistent();
  return refs;
}

export function validateManifest(
  raw: AgentMemoryManifest, request: Pick<ContextAssemblyRequest, 'userId' | 'sessionId'>,
  assets: FixedAssets, budgets: BudgetConfig,
): AgentMemoryManifest {
  assertBytes(raw, budgets);
  const parsed = agentMemoryManifestSchema.safeParse(raw);
  if (!parsed.success) inconsistent();
  const value = parsed.data;
  if (value.userId !== request.userId || value.sessionId !== request.sessionId ||
    value.activeSummaryRef !== null || value.instructionVersion !== assets.instructionVersion ||
    value.knowledgeContentHash !== assets.knowledgeContentHash ||
    value.graphSchemaVersion !== assets.graphSchemaVersion) inconsistent();
  validateReferences(value);
  return value;
}

export function eligible(record: MessageRecord): boolean {
  if (record.role === 'user') {
    return (
      (record.completionStatus === 'accepted' || record.completionStatus === 'completed') &&
      !record.truncated
    );
  }
  if (record.visibility === 'internal' && record.mode === 'live') {
    return (
      record.attemptId !== null &&
      ['completed', 'truncated', 'interrupted', 'cancelled', 'failed'].includes(
        record.completionStatus,
      )
    );
  }
  return (
    record.completionStatus === 'completed' && !record.truncated && record.attemptId !== null
  );
}

export function selectReferences(
  request: ContextAssemblyRequest, rawManifest: AgentMemoryManifest,
  records: readonly MessageRecord[], assets: FixedAssets, budgets: BudgetConfig,
): MessageRecord[] {
  const manifest = validateManifest(rawManifest, request, assets, budgets);
  const refs = validateReferences(manifest);
  if (records.length !== refs.length) inconsistent();
  const parsed = records.map((record) => {
    const value = messageRecordSchema.safeParse(record);
    if (!value.success) inconsistent();
    validateMessageBytes(value.data.content, budgets);
    return value.data;
  });
  if (new Set(parsed.map((record) => record.messageId)).size !== parsed.length) inconsistent();
  const byId = new Map(parsed.map((record) => [record.messageId, record]));
  let currentInputs = 0;
  const selected: MessageRecord[] = [];
  for (const ref of refs) {
    const record = byId.get(ref.messageId);
    if (!record || record.userId !== request.userId || record.sessionId !== request.sessionId ||
      record.eventId !== ref.eventId || record.sequence !== ref.sequence) inconsistent();
    if (record.turnId === request.turnId) {
      if (record.role !== 'user' || !eligible(record) || record.content !== request.newUserInput ||
        ++currentInputs > 1) inconsistent();
      continue;
    }
    if (eligible(record)) selected.push(record);
  }
  return selected;
}

export function buildReferenceManifest(
  userId: string, sessionId: string, contextVersion: number,
  records: readonly MessageRecord[], assets: FixedAssets, budgets: BudgetConfig,
): AgentMemoryManifest {
  const selected = records.map((record) => {
    const value = messageRecordSchema.safeParse(record);
    if (!value.success || value.data.userId !== userId || value.data.sessionId !== sessionId) inconsistent();
    validateMessageBytes(value.data.content, budgets);
    return value.data;
  }).filter(eligible).sort((a, b) => a.sequence - b.sequence);
  const refs = selected.map(({ messageId, eventId, sequence }) => ({ messageId, eventId, sequence }));
  const value: AgentMemoryManifest = {
    schemaVersion: 1, userId, sessionId, contextVersion, messageRefs: refs,
    sourceRanges: refs.length ? [{ fromSequence: refs[0].sequence,
      toSequence: refs.at(-1)!.sequence, fromEventId: refs[0].eventId,
      toEventId: refs.at(-1)!.eventId }] : [],
    activeSummaryRef: null, instructionVersion: assets.instructionVersion,
    knowledgeContentHash: assets.knowledgeContentHash, graphSchemaVersion: assets.graphSchemaVersion,
  };
  return validateManifest(value, { userId, sessionId }, assets, budgets);
}
