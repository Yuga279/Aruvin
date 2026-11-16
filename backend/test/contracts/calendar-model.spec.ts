import { describe, expect, it } from 'vitest';
import { completeToolGroupSchema, repairDiagnosticsSchema, rejectedDecisionSchema,
  nativeToolFragmentSchema, resumableDecisionSchema, type CalendarModelPort } from '../../src/contracts/calendar-model.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';
import type { VerifiedModelLimits } from '../../src/contracts/config-runtime.js';
describe('Calendar native model seam', () => {
  it('requires matched complete groups and bounded normalized diagnostics', () => {
    const group = { assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1',
      type: 'function', function: { name: 'calendar_get_event', arguments: '{"eventId":"abcde"}' } }] },
      result: { role: 'tool', tool_call_id: 'call_1', name: 'calendar_get_event', content: '{"ok":true}' }, sources: [] };
    expect(completeToolGroupSchema.safeParse(group).success).toBe(true);
    expect(completeToolGroupSchema.safeParse({ ...group, result: { ...group.result, tool_call_id: 'other' } }).success).toBe(false);
    expect(completeToolGroupSchema.safeParse({ ...group, assistant: { ...group.assistant,
      tool_calls: [...group.assistant.tool_calls, group.assistant.tool_calls[0]] } }).success).toBe(false);
    const error = { path: 'summary', code: 'missing', expected: 'string' };
    expect(repairDiagnosticsSchema.safeParse([error]).success).toBe(true);
    expect(repairDiagnosticsSchema.safeParse(Array(11).fill(error)).success).toBe(false);
    expect(repairDiagnosticsSchema.safeParse([{ ...error, path: 'accessToken=SECRET' }]).success).toBe(false);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'x'.repeat(16385) } }).success).toBe(false);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'é'.repeat(8192) } }).success).toBe(true);
    expect(nativeToolFragmentSchema.safeParse({ index: 0, function: { arguments: 'é'.repeat(8192) + 'x' } }).success).toBe(false);
    expect(rejectedDecisionSchema.safeParse({ schemaVersion: 1, kind: 'calendar-rejected-decision',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
      dispatchIndex: 1, repairsUsed: 0, rawArgumentsSha256: 'a'.repeat(64), diagnostics: [error],
      createdAt: '2026-10-20T10:00:00.000Z', rawArguments: 'secret' }).success).toBe(false);
    const at = '2026-10-20T10:00:00.000Z';
    const saved = { schemaVersion: 1, kind: 'calendar-model-decision', userId: 'u', sessionId: 's',
      turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
      connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
      rejectedDecisionId: null, decision: null, sources: [], operationId: null, createdAt: at };
    expect(resumableDecisionSchema.safeParse(saved).success).toBe(true);
    expect(resumableDecisionSchema.safeParse({ ...saved, accessToken: 'secret' }).success).toBe(false);
    const source = { schemaVersion: 1, sourceId: 'source', plugin: 'google-calendar', connectionId: 'c',
      connectionRevision: 1, operationIds: ['op'], fetchedAt: at, expiresAt: at, redactedAt: null,
      permission: { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'pending' } };
    expect(resumableDecisionSchema.safeParse({ ...saved, sources: [source], decision: {
      kind: 'text', decisionId: 'd', content: 'Derived event details', truncated: false } }).success).toBe(false);
  });
  it('keeps old text requests assignable and exposes a separate one-dispatch port', () => {
    const old: ModelInvokeRequest = { modelId: 'fixture', user: 'server-user',
      messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 10,
      abortSignal: new AbortController().signal, transforms: [], dataCollection: 'deny' };
    const limits: VerifiedModelLimits = { modelId: 'fixture', contextTokens: 1000,
      outputTokens: 10, supportsMaxTokens: true, source: 'fixture' };
    const model: CalendarModelPort = { async *stream() {
      yield { type: 'failure', failure: { category: 'provider', code: 'INTERRUPTED', retry: 'none' } };
    } };
    expect(old.user).toBe('server-user'); expect(limits.calendar).toBeUndefined();
    expect(model.stream).toBeTypeOf('function');
  });
});
