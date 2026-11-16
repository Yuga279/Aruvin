import { describe, expect, it } from 'vitest';
import { sourceReferenceSchema, persistedCalendarResultSchema, calendarToolResultRecordSchema, effectiveSourceExpiry,
  CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
const now = '2026-10-20T10:00:00.000Z';
const ref = { schemaVersion: 1, sourceId: 'src_1', plugin: 'google-calendar', connectionId: 'con_1',
  connectionRevision: 1, operationIds: ['op_1'], fetchedAt: now,
  expiresAt: '2026-10-20T10:01:00.000Z', redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'approved_1' } };
describe('Calendar source permission', () => {
  it('uses the strictest absolute expiry without a derived-content exception', () => {
    expect(effectiveSourceExpiry(now, [Date.parse(now) + 60000], true)).toBe(ref.expiresAt);
    expect(effectiveSourceExpiry(now, [], false)).toBe(now);
    expect(effectiveSourceExpiry(now, [Date.parse(now)], true)).toBe(now);
    expect(sourceReferenceSchema.safeParse({ ...ref, expiresAt: '2026-10-22T10:00:00.000Z' }).success).toBe(false);
    expect(sourceReferenceSchema.safeParse({ ...ref, operationIds: Array(7).fill('op') }).success).toBe(false);
  });
  it('never makes volatile result bodies durable and preserves legacy messages', () => {
    const volatile = { ...ref, expiresAt: now, permission: { content: 'volatile',
      minimalEvidenceAllowed: true, policyId: 'pending' } };
    expect(persistedCalendarResultSchema.safeParse({ storage: 'reference', source: volatile,
      toolCallId: 'call_1', operationId: 'op_1', outcome: 'ok' }).success).toBe(true);
    expect(persistedCalendarResultSchema.safeParse({ storage: 'reference', source: volatile,
      toolCallId: 'call_1', operationId: 'op_1', outcome: 'ok', rawBody: 'secret' }).success).toBe(false);
    expect(calendarToolResultRecordSchema.safeParse({ schemaVersion: 1, kind: 'calendar-tool-result',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e', sequence: 2,
      toolCallId: 'call_1', createdAt: now, resultRef: { storage: 'reference', source: volatile,
        toolCallId: 'wrong', operationId: 'op_1', outcome: 'ok' } }).success).toBe(false);
    const legacy = { schemaVersion: 1, userId: 'u', sessionId: 's', turnId: 't', messageId: 'm',
      eventId: 'e', sequence: 1, role: 'assistant', content: 'Hello', createdAt: now,
      completionStatus: 'completed', attemptId: 'a', truncated: false };
    expect(messageRecordSchema.parse(legacy)).toEqual(legacy);
    expect(messageRecordSchema.parse({ ...legacy, content: CALENDAR_TOMBSTONE,
      sourceProvenance: [volatile] }).messageId).toBe('m');
  });
});
