import { describe, expect, it } from 'vitest';
import { calendarReceiptSchema } from '../../../src/contracts/calendar-operations.js';
import { apiToolsFixture, googleEvent, OWNED_CALENDAR, POLICY_DEADLINE_AHEAD_MS, readBinding, savedOperation } from './tools-fixtures.js';
import { multiOperation, multiTarget } from './tools-multi-fixtures.js';

describe('direct Calendar tools', () => {
  it('executes direct API tools only under current persisted operation authority', async () => {
    const f = apiToolsFixture();
    const denied = await f.tools.invoke({ ...f.input,
      binding: { ...f.input.binding, operation: null } });
    expect(denied).toMatchObject({ outcome: 'failure', failure: {
      category: 'policy', code: 'OPERATION_AUTHORITY_REQUIRED', retry: 'none',
    } });
    expect(f.requests).toHaveLength(0);
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', receipt: {
      operationId: f.input.binding.operation!.operationId,
      googleEventId: f.input.binding.operation!.googleEventId,
    } });
    expect(f.counts.calendar).toBe(1);
    expect(JSON.stringify(result)).not.toContain('fixture-access-token');
    expect(f.requests).toHaveLength(1);
    await f.tools.close();
  });

  it('executes zero requests when a forbidden field or a disabled gate is present', async () => {
    const f = apiToolsFixture();
    const forbidden = await f.tools.invoke({ ...f.input, call: { name: 'calendar_create_event',
      arguments: { ...f.input.call.arguments, attendees: [{ email: 'x@example.com' }] } } as never });
    expect(forbidden).toMatchObject({ outcome: 'failure', failure: { category: 'policy' } });
    expect(f.requests).toHaveLength(0);
    f.gate.disable();
    const disabled = await f.tools.invoke(f.input);
    expect(disabled).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  });

  it('never requests a credential when a policy rejection happens before execution', async () => {
    const f = apiToolsFixture();
    const denied = await f.tools.invoke({ ...f.input,
      binding: { ...f.input.binding, operation: null } });
    expect(denied).toMatchObject({ outcome: 'failure' });
    expect(f.counts.credential).toBe(0);
    expect(f.counts.calendar).toBe(0);
    expect(f.requests).toHaveLength(0);
  });

  it('re-checks the connection after a refresh and before each effect', async () => {
    const f = apiToolsFixture();
    f.gate.revision(2);
    const stale = await f.tools.invoke(f.input);
    expect(stale).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  });

  it('counts every actual delivery and no discovery or credential call', async () => {
    const f = apiToolsFixture();
    await f.tools.invoke(f.input);
    expect(f.counts.calendar).toBe(1);
    expect(f.counts.refresh).toBe(0);
  });

  it('rejects a repeated invocation once the operation authority is spent', async () => {
    const f = apiToolsFixture();
    const first = await f.tools.invoke(f.input);
    expect(first).toMatchObject({ outcome: 'success' });
    const second = await f.tools.invoke({ ...f.input,
      binding: { ...f.input.binding, operation: { ...f.input.binding.operation!,
        state: 'succeeded' } as never } });
    expect(second).toMatchObject({ outcome: 'failure', failure: { category: 'policy' } });
  });

  it('returns a volatile source when retention is not permitted', async () => {
    const f = apiToolsFixture();
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', source: {
      permission: { content: 'volatile' },
    } });
    expect((result as { source: { expiresAt: string; fetchedAt: string } }).source.expiresAt)
      .toBe((result as { source: { fetchedAt: string } }).source.fetchedAt);
  });

  it('keeps retained content only while a policy deadline and headers allow it', async () => {
    const policyDeadline = Date.now() + POLICY_DEADLINE_AHEAD_MS;
    const f = apiToolsFixture({
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      policyDeadlines: [policyDeadline],
    });
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', source: {
      permission: { content: 'retained' },
    } });
    const source = (result as { source: { expiresAt: string; fetchedAt: string } }).source;
    expect(Date.parse(source.expiresAt)).toBeLessThanOrEqual(policyDeadline);
    expect(Date.parse(source.expiresAt)).toBeGreaterThan(Date.parse(source.fetchedAt));
  });

  it('falls back to volatile when the response forbids caching', async () => {
    const f = apiToolsFixture({
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      headers: { 'cache-control': 'no-store' },
    });
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', source: {
      permission: { content: 'volatile' },
    } });
  });

  it('keeps content volatile for no-cache, zero freshness and an exhausted age', async () => {
    for (const headers of [{ 'cache-control': 'no-cache' }, { 'cache-control': 'max-age=0' },
      { 'cache-control': 'max-age=60', age: '120' }] as Array<Record<string, string>>) {
      const f = apiToolsFixture({
        permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
        headers,
      });
      const result = await f.tools.invoke(f.input);
      expect(result).toMatchObject({ outcome: 'success', source: {
        permission: { content: 'volatile' },
      } });
    }
  });

  it('never keeps retained content past the earliest permitted deadline', async () => {
    const policyDeadline = Date.now() + POLICY_DEADLINE_AHEAD_MS;
    const f = apiToolsFixture({
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      policyDeadlines: [policyDeadline],
      headers: { 'cache-control': 'max-age=60' },
    });
    const result = await f.tools.invoke(f.input);
    const source = (result as { source: { expiresAt: string; fetchedAt: string } }).source;
    expect(Date.parse(source.expiresAt)).toBeLessThanOrEqual(policyDeadline);
    expect(Date.parse(source.expiresAt)).toBeGreaterThan(Date.parse(source.fetchedAt));
    expect(Date.parse(source.expiresAt) - Date.parse(source.fetchedAt))
      .toBeLessThanOrEqual(86400000);
  });

  it('keeps content volatile without a live policy deadline', async () => {
    for (const policyDeadlines of [[], [Date.now() - 60_000]]) {
      const f = apiToolsFixture({
        permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
        policyDeadlines,
      });
      const result = await f.tools.invoke(f.input);
      expect(result).toMatchObject({ outcome: 'success', source: {
        permission: { content: 'volatile' },
      } });
    }
  });

  it('never asks for a credential when the policy already rejected the call', async () => {
    const f = apiToolsFixture();
    const denied = await f.tools.invoke({ ...f.input, call: { name: 'calendar_create_event',
      arguments: { ...f.input.call.arguments, attendees: [{ email: 'x@example.com' }] } } as never });
    expect(denied).toMatchObject({ outcome: 'failure' });
    expect(f.counts.credential).toBe(0);
    expect(f.requests).toHaveLength(0);
  });

  it('denies creation when minimal evidence is not permitted', async () => {
    const f = apiToolsFixture({
      permission: { content: 'volatile', minimalEvidenceAllowed: false, policyId: 'fixture-policy' },
    });
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  });

  it('reads back a stored event without a second write', async () => {
    const operation = multiOperation(multiTarget('owner', OWNED_CALENDAR));
    const f = apiToolsFixture({
      steps: [{ method: 'GET', path: `/calendar/v3/calendars/owned/events/${operation.googleEventId}`,
        response: () => Response.json({ ...googleEvent(), id: operation.googleEventId,
          extendedProperties: { private: { aurvinOperationId: operation.operationId,
            aurvinRequestHash: operation.requestHash } } }) }],
    });
    const outcome = await f.tools.readback({ ...f.input, operation });
    expect(outcome).toMatchObject({ outcome: 'matched', receipt: {
      operationId: operation.operationId, googleEventId: operation.googleEventId,
    } });
    expect(f.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(f.counts.calendar).toBe(1);
  });

  it('reports an absent readback without inventing a receipt', async () => {
    const operation = multiOperation(multiTarget('owner', OWNED_CALENDAR));
    const f = apiToolsFixture({
      steps: [{ method: 'GET', path: `/calendar/v3/calendars/owned/events/${operation.googleEventId}`,
        response: () => Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 }) }],
    });
    expect(await f.tools.readback({ ...f.input, operation })).toMatchObject({ outcome: 'absent' });
  });

  it('closes idempotently and refuses later work', async () => {
    const f = apiToolsFixture();
    await f.tools.close();
    await f.tools.close();
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  });

  it('never exposes a credential or a raw provider failure', async () => {
    const f = apiToolsFixture({ steps: [{ method: 'POST', path: '/calendar/v3/calendars/owned/events',
      response: () => Response.json({ error: { message: 'token ya29.secret expired' } }, { status: 500 }) }] });
    const result = await f.tools.invoke(f.input);
    const text = JSON.stringify(result);
    expect(text).not.toContain('ya29');
    expect(text).not.toContain('fixture-access-token');
    expect(result).toMatchObject({ outcome: 'failure', failure: { category: 'uncertain' } });
  });

  it('reads a bounded list through the same trusted path', async () => {
    const f = apiToolsFixture({
      call: { name: 'calendar_list_events', arguments: { timeMin: '2026-10-21T00:00:00Z',
        timeMax: '2026-10-22T00:00:00Z', maxResults: 5 } },
      steps: [{ method: 'GET', path: '/calendar/v3/calendars/owned/events',
        response: () => Response.json({ timeZone: 'Etc/UTC', items: [googleEvent()] }) }],
    });
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', result: {
      tool: 'calendar_list_events', events: [{ eventId: 'abcde01234' }] } });
    expect(result).toHaveProperty('receipt', null);
    expect((result as { source: { toolCallIds: string[] } }).source.toolCallIds)
      .toEqual([f.input.binding.toolCallId]);
  });

  it('reads a single event through the same trusted path', async () => {
    const f = apiToolsFixture({
      call: { name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } },
      steps: [{ method: 'GET', path: '/calendar/v3/calendars/owned/events/abcde01234',
        response: () => Response.json(googleEvent()) }],
    });
    const result = await f.tools.invoke(f.input);
    expect(result).toMatchObject({ outcome: 'success', result: {
      tool: 'calendar_get_event', event: { eventId: 'abcde01234' } } });
    expect(f.counts.calendar).toBe(1);
  });

  it('makes zero requests and rejects legacy invoke', async () => {
    const f = apiToolsFixture();
    const legacy = await f.tools.invoke({
      ...f.input,
      binding: readBinding() as never,
    });
    expect(legacy).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
    expect(f.counts.calendar).toBe(0);
  });

  it('keeps legacy unknown-operation readback GET-only with no new v2 receipt', async () => {
    const operation = savedOperation();
    const f = apiToolsFixture({
      steps: [{
        method: 'GET',
        path: `/calendar/v3/calendars/owned/events/${operation.googleEventId}`,
        response: () => Response.json({ ...googleEvent(), id: operation.googleEventId }),
      }],
    });
    const outcome = await f.tools.readback({ ...f.input, operation });
    expect(outcome).toMatchObject({ outcome: 'unknown' });
    expect(outcome).not.toHaveProperty('receipt');
    expect(f.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('decodes a legacy v1 receipt separately for audit reconciliation', () => {
    const legacyReceipt = {
      operationId: 'op_legacy',
      googleEventId: 'abcde01234',
      connectionId: 'c',
      connectionRevision: 1,
      targetRevision: 1,
      calendarIdHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      requestHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      verifiedAt: '2026-10-21T08:00:00.000Z',
      source: {
        schemaVersion: 1,
        sourceId: 's1',
        plugin: 'google-calendar',
        connectionId: 'c',
        connectionRevision: 1,
        operationIds: ['op_legacy'],
        fetchedAt: '2026-10-21T08:00:00.000Z',
        expiresAt: '2026-10-21T08:00:00.000Z',
        redactedAt: null,
        permission: { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      },
      htmlLink: null,
    };
    expect(calendarReceiptSchema.parse(legacyReceipt)).toMatchObject({ operationId: 'op_legacy' });
  });
});
