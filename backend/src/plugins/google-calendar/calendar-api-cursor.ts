/**
 * ============================================================================
 * FILE: calendar-api-cursor.ts
 * LOCATION: backend/src/plugins/google-calendar/calendar-api-cursor.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide process-local signed continuation cursors for events and discovery pages.
 *
 * ROLE IN PROJECT:
 *    Cryptographically signs and validates pagination tokens bound to target discovery,
 *    query scope, and short-lived expiry without exposing raw Google continuation tokens.
 *
 * KEY COMPONENTS:
 *    - CalendarCursor: Class encoding and decoding v2 HMAC-signed continuations.
 *    - CalendarCursorScope: Discriminator and metadata for events vs calendars paging.
 *    - CalendarCursorArgs: Projection union for query parameters.
 *    - decodeLegacy: Read-only inspection of legacy v1 continuation tokens.
 * ============================================================================
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CalendarConnectionBinding } from '../../contracts/calendar-connections.js';
import type { CalendarAccountBinding, CalendarResolvedTarget } from '../../contracts/calendar-discovery.js';
import { calendarCursorV1PayloadSchema, calendarCursorV2PayloadSchema }
  from '../../contracts/calendar-compatibility.js';
import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';
import { toolFault } from './tools-validation.js';

export const CALENDAR_CURSOR_MAX_LENGTH = 2048;
export const CALENDAR_CURSOR_VERSION = 2;
const KEY_BYTES = 32;
const SIGNATURE_HEX_LENGTH = 64;

export type CalendarCursorBinding = CalendarAccountBinding | CalendarResolvedTarget;
export type CalendarCursorScope = { kind: 'events' | 'calendars'; discoveryRevision: number; expiresAt: string };
export type CalendarCursorArgs = { timeMin: string; timeMax: string; maxResults: number }
  | { snapshotHash: string; pageSize: number };

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const bindingFingerprint = (binding: CalendarCursorBinding, kind: 'events' | 'calendars'): string => {
  if (kind === 'events') {
    if (!('calendarId' in binding) || !('targetRevision' in binding)) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    return sha256(JSON.stringify({
      userId: binding.userId,
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      googleSubjectId: binding.googleSubjectId,
      calendarId: binding.calendarId,
      targetRevision: binding.targetRevision,
    }));
  }
  return sha256(JSON.stringify({
    userId: binding.userId,
    connectionId: binding.connectionId,
    connectionRevision: binding.connectionRevision,
    googleSubjectId: binding.googleSubjectId,
  }));
};

const queryFingerprint = (args: CalendarCursorArgs): string => {
  if ('timeMin' in args) {
    return sha256(JSON.stringify({
      timeMin: args.timeMin, timeMax: args.timeMax, maxResults: args.maxResults,
    }));
  }
  return sha256(JSON.stringify({
    snapshotHash: args.snapshotHash, pageSize: args.pageSize,
  }));
};

function rejectCursor(diagnostic: DiagnosticSink | undefined, reason: string): never {
  diagnose(diagnostic, {
    stage: 'cursor', state: 'rejected', reason, field: 'pageToken', expected: 'valid-cursor',
    suppliedType: 'string', presence: 'present', origin: 'local', delivery: 'not-sent',
    code: 'CALENDAR_INPUT_REJECTED',
  });
  throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
}

/**
 * A process-local signed continuation. The signature binds the provider token to
 * the trusted target/account, discovery revision, and the exact query scope, so a cursor
 * cannot be replayed across calendars, snapshots, queries, or after expiry.
 *
 * ponytail: process-local cursor signatures invalidate on restart; a future
 * cross-process deployment needs a managed rotation key.
 */
export class CalendarCursor {
  private readonly key: Buffer;
  private readonly clock: () => number;
  private readonly diagnostic: DiagnosticSink | undefined;

  constructor(key: Uint8Array = randomBytes(KEY_BYTES), clock: () => number = () => Date.now(),
    diagnostic?: DiagnosticSink) {
    if (key.length !== KEY_BYTES) throw toolFault('policy', 'CALENDAR_TARGET_REQUIRED');
    this.key = Buffer.from(key);
    this.clock = clock;
    this.diagnostic = diagnostic;
  }

  encode(
    token: string,
    binding: CalendarCursorBinding,
    args: CalendarCursorArgs,
    scope: CalendarCursorScope,
  ): string {
    if (typeof token !== 'string' || token.length === 0) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    if (scope.kind === 'calendars' && !/^(0|[1-9]\d*)$/.test(token)) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    const exp = Date.parse(scope.expiresAt);
    const now = this.clock();
    if (!Number.isFinite(exp) || exp <= now || exp - now > 300000) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    const parsedPayload = calendarCursorV2PayloadSchema.safeParse({
      v: CALENDAR_CURSOR_VERSION,
      b: bindingFingerprint(binding, scope.kind),
      q: queryFingerprint(args),
      t: token,
      kind: scope.kind,
      discoveryRevision: scope.discoveryRevision,
      expiresAt: scope.expiresAt,
    });
    if (!parsedPayload.success) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    const payload = Buffer.from(JSON.stringify(parsedPayload.data), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.key).update(payload, 'utf8').digest('hex');
    const cursor = `${payload}.${signature}`;
    if (cursor.length > CALENDAR_CURSOR_MAX_LENGTH) {
      throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    return cursor;
  }

  decode(
    cursor: string,
    binding: CalendarCursorBinding,
    args: CalendarCursorArgs,
    scope: CalendarCursorScope,
  ): string {
    if (typeof cursor !== 'string' || cursor.length === 0
      || cursor.length > CALENDAR_CURSOR_MAX_LENGTH) rejectCursor(this.diagnostic, 'cursor-format');
    const separator = cursor.indexOf('.');
    if (separator <= 0) rejectCursor(this.diagnostic, 'cursor-format');
    const payload = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/u.test(signature)) rejectCursor(this.diagnostic, 'cursor-format');
    const expected = createHmac('sha256', this.key).update(payload, 'utf8').digest('hex');
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      rejectCursor(this.diagnostic, 'cursor-signature');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      rejectCursor(this.diagnostic, 'cursor-format');
    }
    const parsed = calendarCursorV2PayloadSchema.safeParse(decoded);
    if (!parsed.success) rejectCursor(this.diagnostic, 'cursor-format');
    if (parsed.data.kind !== scope.kind) rejectCursor(this.diagnostic, 'cursor-scope');
    if (parsed.data.discoveryRevision !== scope.discoveryRevision) rejectCursor(this.diagnostic, 'cursor-scope');
    if (parsed.data.expiresAt !== scope.expiresAt) rejectCursor(this.diagnostic, 'cursor-scope');
    if (Date.parse(parsed.data.expiresAt) <= this.clock()) rejectCursor(this.diagnostic, 'cursor-expired');
    if (parsed.data.b !== bindingFingerprint(binding, scope.kind)) rejectCursor(this.diagnostic, 'cursor-scope');
    if (parsed.data.q !== queryFingerprint(args)) rejectCursor(this.diagnostic, 'cursor-scope');
    if (scope.kind === 'calendars' && !/^(0|[1-9]\d*)$/.test(parsed.data.t)) {
      rejectCursor(this.diagnostic, 'cursor-format');
    }
    return parsed.data.t;
  }

  decodeLegacy(
    cursor: string,
    binding: CalendarConnectionBinding,
    args: { timeMin: string; timeMax: string; maxResults: number },
  ): string {
    if (typeof cursor !== 'string' || cursor.length === 0
      || cursor.length > CALENDAR_CURSOR_MAX_LENGTH) rejectCursor(this.diagnostic, 'cursor-format');
    const separator = cursor.indexOf('.');
    if (separator <= 0) rejectCursor(this.diagnostic, 'cursor-format');
    const payload = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/u.test(signature)) rejectCursor(this.diagnostic, 'cursor-format');
    const expected = createHmac('sha256', this.key).update(payload, 'utf8').digest('hex');
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      rejectCursor(this.diagnostic, 'cursor-signature');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      rejectCursor(this.diagnostic, 'cursor-format');
    }
    const parsed = calendarCursorV1PayloadSchema.safeParse(decoded);
    if (!parsed.success) rejectCursor(this.diagnostic, 'cursor-format');
    const legacyB = sha256(JSON.stringify({
      userId: binding.userId, connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision, googleSubjectId: binding.googleSubjectId,
      calendarId: binding.calendarId, targetRevision: binding.targetRevision,
    }));
    const legacyQ = sha256(JSON.stringify({
      timeMin: args.timeMin, timeMax: args.timeMax, maxResults: args.maxResults,
    }));
    if (parsed.data.b !== legacyB || parsed.data.q !== legacyQ) {
      rejectCursor(this.diagnostic, 'cursor-scope');
    }
    return parsed.data.t;
  }
}
