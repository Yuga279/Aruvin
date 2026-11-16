/**
 * ============================================================================
 * FILE: config-budget.spec.ts
 * LOCATION: backend/test/context/config-budget.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify attempt-budget projections and immutable context assembly.
 *
 * ROLE IN PROJECT:
 *    Ensures ReferencedContextAssembler projects tighter or revised attempt budgets
 *    without mutating base assemblers, dropping history, or rewriting manifests.
 *
 * KEY COMPONENTS:
 *    - forBudgets: Pure projection onto specified attempt BudgetConfig.
 * ============================================================================
 */

import { it, expect, vi } from 'vitest';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { ports, history, manifest, request, record, assets } from './fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';

it('projects tighter context limits without dropping or rewriting history', async () => {
  const d = ports();
  const base = new ReferencedContextAssembler(d);
  const before = await base.assemble(request);
  const tighter = textSnapshot(2, { maxMessagesInContext: 5 });
  const result = await base.forBudgets(tighter.budgets).assemble(request);
  expect(result).toMatchObject({ ok: false, overflow: { code: 'CONTEXT_BUDGET_EXCEEDED' } });
  expect(await base.assemble(request)).toEqual(before);
  expect(d.memory.put).not.toHaveBeenCalled();
  expect(d.messages.append).not.toHaveBeenCalled();
  await expect(d.memory.get.mock.results[0].value).resolves.toEqual(manifest(history));
});

it('returns overflow when smaller context token ceiling with larger output reserve is projected', async () => {
  const d = ports();
  const base = new ReferencedContextAssembler(d);
  const snap = textSnapshot(2, {
    maxInputTokens: 128,
    maxContextTokens: 2250,
    maxOutputTokens: 1200,
    modelMarginTokens: 128,
  });
  const projected = base.forBudgets(snap.budgets);
  const res = await projected.assemble(request);
  expect(res).toMatchObject({ ok: false, overflow: { code: 'CONTEXT_BUDGET_EXCEEDED' } });
  expect(d.memory.put).not.toHaveBeenCalled();
});

it('rejects multibyte input exceeding snapshot maxInputTokens', async () => {
  const d = ports();
  const base = new ReferencedContextAssembler(d);
  const snap = textSnapshot(2, {
    maxInputTokens: 128,
    maxContextTokens: 2048,
    maxOutputTokens: 128,
    modelMarginTokens: 128,
  });
  const multibyte = '🔥'.repeat(40);
  const projected = base.forBudgets(snap.budgets);
  await expect(projected.assemble({ ...request, newUserInput: multibyte }))
    .rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
});

it('includes current-turn input already in manifest exactly once and keeps history ordered', async () => {
  const userMsg = record({ messageId: 'm3', eventId: 'e3', sequence: 2, turnId: 't2', role: 'user', content: 'What next?' });
  const recordsWithCurrent = [...history, userMsg];
  const d = ports(recordsWithCurrent);
  const base = new ReferencedContextAssembler(d);
  const snap = textSnapshot(2);
  const projected = base.forBudgets(snap.budgets);
  const res = await projected.assemble(request);
  expect(res.ok).toBe(true);
  if (res.ok) {
    const userMessages = res.context.messages.filter(m => m.role === 'user' && m.content === 'What next?');
    expect(userMessages).toHaveLength(1);
    expect(res.context.messages[3]).toEqual({ role: 'system', content: 'Response mode: text.' });
    expect(res.context.messages[4].content).toBe('Hello');
    expect(res.context.messages[5].content).toBe('Hi');
    expect(res.context.messages[6]).toEqual({ role: 'user', content: 'What next?' });
    expect(res.context.contextVersion).toBe(1);
    expect(res.context.instructionVersion).toBe(assets.instructionVersion);
  }
  expect(d.memory.put).not.toHaveBeenCalled();
});

it('enforces byte/storage limits against history records', async () => {
  const historyWithLongMsg = [record({ content: 'x'.repeat(1000) })];
  const d = ports(historyWithLongMsg);
  const base = new ReferencedContextAssembler(d);
  const snap = textSnapshot(2);
  const tighter = base.forBudgets({ ...snap.budgets, maxMessageBytes: 200 });
  await expect(tighter.assemble(request)).rejects.toMatchObject({ code: 'NOT_READY' });
});

it('projects internal assistant voice delivery through forBudgets projection', async () => {
  const voiceRecs = [
    record({ visibility: 'internal', mode: 'live' }),
    record({
      messageId: 'm2', eventId: 'e2', sequence: 1, role: 'assistant',
      content: 'Hello. More.', completionStatus: 'completed',
      attemptId: 'a1', visibility: 'internal', mode: 'live',
    }),
  ];
  const deliveryRec = voiceDeliveryRecordSchema.parse({
    ...deliveryFixture(),
    userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
    status: 'interrupted', textGenerated: 'Hello. More.',
    textSpoken: 'Hello.', textRemaining: ' More.',
  });
  const d = ports(voiceRecs);
  (d as { metadata?: { getVoiceDelivery: unknown } }).metadata = { getVoiceDelivery: vi.fn(async () => deliveryRec) };
  const base = new ReferencedContextAssembler(d as unknown as import('../../src/context/referenced-context-assembler.js').ContextDependencies);
  const snap = textSnapshot(2);
  const res = await base.forBudgets(snap.budgets).assemble(request);
  expect(res.ok).toBe(true);
  if (res.ok) {
    const assistant = res.context.messages.find(m => m.role === 'assistant');
    expect(assistant?.content).toBe('Hello.');
  }
  expect(d.memory.put).not.toHaveBeenCalled();
});
