import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CalendarCursor } from '../../../src/plugins/google-calendar/calendar-api-cursor.js';
import { FIXTURE_BINDING } from './tools-fixtures.js';
import { multiTarget } from './tools-multi-fixtures.js';

const args = { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z', maxResults: 20 };
const key = () => new Uint8Array(32).fill(1);
const defaultScope = () => ({
  kind: 'events' as const,
  discoveryRevision: 1,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
});

describe('Calendar continuation cursor', () => {
  it('issues v2 cursors bound to target discovery, kind and expiry', () => {
    const now = Date.now();
    const target = multiTarget('writer', 'shared', new Date(now).toISOString());
    const cursor = new CalendarCursor(key(), () => now);
    const scope = { kind: 'events' as const, discoveryRevision: 1,
      expiresAt: new Date(now + 300000).toISOString() };
    const encoded = cursor.encode('provider-2', target, args, scope);
    const payload = JSON.parse(Buffer.from(encoded.split('.')[0]!, 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ v: 2, kind: 'events', discoveryRevision: 1, expiresAt: scope.expiresAt });
    expect(cursor.decode(encoded, target, args, scope)).toBe('provider-2');
    for (const changed of [{ ...target, calendarId: 'other' }, { ...target, googleSubjectId: 'replacement' },
      { ...target, connectionRevision: 2 }, { ...target, targetRevision: 2 }]) {
      expect(() => cursor.decode(encoded, changed, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    }
    expect(() => cursor.decode(encoded, target, args, { ...scope, kind: 'calendars' }))
      .toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => cursor.decode(encoded, target, args, { ...scope, discoveryRevision: 2 }))
      .toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => new CalendarCursor(key(), () => now + 300000).decode(encoded, target, args, scope))
      .toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('rejects correctly sized nonhex signatures and legacy tokens for v2 dispatch', () => {
    const target = multiTarget();
    const cursor = new CalendarCursor(key());
    const scope = defaultScope();
    const encoded = cursor.encode('provider-2', target, args, scope);
    expect(() => cursor.decode(encoded.split('.')[0] + '.' + 'z'.repeat(64), target, args, scope))
      .toThrow('CALENDAR_INPUT_REJECTED');
    const legacy = Buffer.from(JSON.stringify({ v: 1, b: 'a'.repeat(64), q: 'b'.repeat(64), t: 'p2' }))
      .toString('base64url');
    const signature = createHmac('sha256', key()).update(legacy).digest('hex');
    expect(() => cursor.decode(`${legacy}.${signature}`, target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('round trips a provider token inside the frozen length bound', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    const encoded = cursor.encode('google-page-2', target, args, scope);
    expect(encoded.length).toBeLessThanOrEqual(2048);
    expect(cursor.decode(encoded, target, args, scope)).toBe('google-page-2');
  });

  it('rejects an altered signature and a malformed payload', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    const encoded = cursor.encode('google-page-2', target, args, scope);
    const altered = `${encoded.slice(0, -1)}${encoded.endsWith('A') ? 'B' : 'A'}`;
    expect(() => cursor.decode(altered, target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => cursor.decode('not-a-cursor', target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => cursor.decode('', target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => cursor.decode('a.b.c', target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('rejects an oversized cursor input before any request', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    expect(() => cursor.decode('x'.repeat(2049), target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('binds the cursor to the range, page size and trusted target', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    const encoded = cursor.encode('google-page-2', target, args, scope);
    const changed: Array<[string, unknown]> = [
      ['timeMin', { ...args, timeMin: '2026-01-02T00:00:00Z' }],
      ['timeMax', { ...args, timeMax: '2026-01-09T00:00:00Z' }],
      ['maxResults', { ...args, maxResults: 5 }],
    ];
    for (const [, changedArgs] of changed) {
      expect(() => cursor.decode(encoded, target, changedArgs as typeof args, scope))
        .toThrow('CALENDAR_INPUT_REJECTED');
    }
    const targets = [
      { ...target, userId: 'other' },
      { ...target, connectionId: 'other' },
      { ...target, connectionRevision: 2 },
      { ...target, googleSubjectId: 'other' },
      { ...target, calendarId: 'other' },
      { ...target, targetRevision: 2 },
    ];
    for (const changedTarget of targets) {
      expect(() => cursor.decode(encoded, changedTarget, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    }
  });

  it('rejects a cursor issued under a different process key', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const issued = new CalendarCursor(key());
    const other = new CalendarCursor(new Uint8Array(32).fill(2));
    const encoded = issued.encode('google-page-2', target, args, scope);
    expect(() => other.decode(encoded, target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('carries a provider token as one value that cannot inject a query parameter', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    const hostile = 'abc&pageToken=evil#frag';
    const encoded = cursor.encode(hostile, target, args, scope);
    expect(cursor.decode(encoded, target, args, scope)).toBe(hostile);
    const query = new URLSearchParams({ pageToken: cursor.decode(encoded, target, args, scope) });
    expect(query.getAll('pageToken')).toEqual([hostile]);
  });

  it('refuses to wrap a provider continuation that cannot fit the bound', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const cursor = new CalendarCursor(key());
    expect(() => cursor.encode('x'.repeat(4000), target, args, scope))
      .toThrow('CALENDAR_RESPONSE_INVALID');
  });

  it('decodes legacy v1 signed tokens strictly through decodeLegacy without active v1 issuance', () => {
    const cursor = new CalendarCursor(key());
    const legacyB = createHash('sha256').update(JSON.stringify({
      userId: FIXTURE_BINDING.userId, connectionId: FIXTURE_BINDING.connectionId,
      connectionRevision: FIXTURE_BINDING.connectionRevision, googleSubjectId: FIXTURE_BINDING.googleSubjectId,
      calendarId: FIXTURE_BINDING.calendarId, targetRevision: FIXTURE_BINDING.targetRevision,
    })).digest('hex');
    const legacyQ = createHash('sha256').update(JSON.stringify({
      timeMin: args.timeMin, timeMax: args.timeMax, maxResults: args.maxResults,
    })).digest('hex');
    const payload = Buffer.from(JSON.stringify({ v: 1, b: legacyB, q: legacyQ, t: 'p2' })).toString('base64url');
    const signature = createHmac('sha256', key()).update(payload).digest('hex');
    const token = `${payload}.${signature}`;
    expect(cursor.decodeLegacy(token, FIXTURE_BINDING, args)).toBe('p2');
    expect(() => cursor.decode(token, multiTarget(), args, defaultScope())).toThrow('CALENDAR_INPUT_REJECTED');
  });

  it('observes format signature scope and authenticated expiry without revealing cursors', () => {
    let now = Date.parse('2026-10-27T10:00:00Z');
    const target = multiTarget('writer', 'shared', new Date(now).toISOString());
    const scope = { kind: 'events' as const, discoveryRevision: 1, expiresAt: new Date(now + 1000).toISOString() };
    const facts: Record<string, unknown>[] = [];
    const cursor = new CalendarCursor(key(), () => now, f => { facts.push({ ...f }); });
    const token = cursor.encode('PRIVATE_PROVIDER_TOKEN', target, args, scope);
    const parts = token.split('.');
    const wrongSignature = `${parts[0]}.${parts[1]![0] === '0' ? '1' : '0'}${parts[1]!.slice(1)}`;
    const check = (run: () => unknown, reason: string) => {
      expect(run).toThrow('CALENDAR_INPUT_REJECTED');
      expect(facts.at(-1)).toMatchObject({ stage: 'cursor', state: 'rejected', reason,
        field: 'pageToken', expected: 'valid-cursor', suppliedType: 'string', presence: 'present',
        origin: 'local', delivery: 'not-sent', code: 'CALENDAR_INPUT_REJECTED' });
    };
    check(() => cursor.decode('not-a-cursor', target, args, scope), 'cursor-format');
    check(() => cursor.decode(wrongSignature, target, args, scope), 'cursor-signature');
    check(() => cursor.decode(token, target, { ...args, maxResults: 5 }, scope), 'cursor-scope');
    now += 1001;
    check(() => cursor.decode(token, target, args, scope), 'cursor-expired');
    expect(JSON.stringify(facts)).not.toContain(token);
    expect(JSON.stringify(facts)).not.toContain('PRIVATE_PROVIDER_TOKEN');
  });

  it('classifies authenticated account query and revision mismatches as scope', () => {
    const facts: Record<string, unknown>[] = [];
    const now = Date.parse('2026-10-27T10:00:00Z');
    const target = multiTarget('writer', 'shared', new Date(now).toISOString());
    const scope = { kind: 'events' as const, discoveryRevision: 1, expiresAt: new Date(now + 1000).toISOString() };
    const cursor = new CalendarCursor(key(), () => now, f => { facts.push({ ...f }); });
    const token = cursor.encode('token', target, args, scope);
    const expectScope = (run: () => unknown) => {
      expect(run).toThrow('CALENDAR_INPUT_REJECTED');
      expect(facts.at(-1)).toMatchObject({ reason: 'cursor-scope' });
    };
    expectScope(() => cursor.decode(token, { ...target, userId: 'other' }, args, scope));
    expectScope(() => cursor.decode(token, target, { ...args, timeMin: '2026-01-02T00:00:00Z' }, scope));
    expectScope(() => cursor.decode(token, target, args, { ...scope, discoveryRevision: 2 }));
    const other = new CalendarCursor(new Uint8Array(32).fill(2), () => now, f => { facts.push({ ...f }); });
    expect(() => other.decode(token, target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(facts.at(-1)).toMatchObject({ reason: 'cursor-signature' });
  });

  it('observes legacy decoder format and scope without inventing expiry', () => {
    const facts: Record<string, unknown>[] = [];
    const cursor = new CalendarCursor(key(), () => Date.now(), f => { facts.push({ ...f }); });
    const legacyB = createHash('sha256').update(JSON.stringify({
      userId: FIXTURE_BINDING.userId, connectionId: FIXTURE_BINDING.connectionId,
      connectionRevision: FIXTURE_BINDING.connectionRevision, googleSubjectId: FIXTURE_BINDING.googleSubjectId,
      calendarId: FIXTURE_BINDING.calendarId, targetRevision: FIXTURE_BINDING.targetRevision,
    })).digest('hex');
    const legacyQ = createHash('sha256').update(JSON.stringify({
      timeMin: args.timeMin, timeMax: args.timeMax, maxResults: args.maxResults,
    })).digest('hex');
    const payload = Buffer.from(JSON.stringify({ v: 1, b: legacyB, q: legacyQ, t: 'p2' })).toString('base64url');
    const signature = createHmac('sha256', key()).update(payload).digest('hex');
    const token = `${payload}.${signature}`;
    expect(cursor.decodeLegacy(token, FIXTURE_BINDING, args)).toBe('p2');
    expect(() => cursor.decodeLegacy('not-a-cursor', FIXTURE_BINDING, args)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(facts.at(-1)).toMatchObject({ reason: 'cursor-format' });
    expect(() => cursor.decodeLegacy(token, { ...FIXTURE_BINDING, calendarId: 'other' }, args))
      .toThrow('CALENDAR_INPUT_REJECTED');
    expect(facts.at(-1)).toMatchObject({ reason: 'cursor-scope' });
    expect(facts.some(f => f.reason === 'cursor-expired')).toBe(false);
  });

  it('keeps throwing or omitted sinks from changing cursor faults', () => {
    const target = multiTarget();
    const scope = defaultScope();
    const silent = new CalendarCursor(key());
    const throwing = new CalendarCursor(key(), () => Date.now(), () => { throw new Error('secret'); });
    const token = silent.encode('google-page-2', target, args, scope);
    expect(() => throwing.decode('not-a-cursor', target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(() => silent.decode('not-a-cursor', target, args, scope)).toThrow('CALENDAR_INPUT_REJECTED');
    expect(silent.decode(token, target, args, scope)).toBe('google-page-2');
    expect(throwing.decode(token, target, args, scope)).toBe('google-page-2');
  });
});
