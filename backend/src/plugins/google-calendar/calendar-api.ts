/**
 * ============================================================================
 * FILE: calendar-api.ts
 * LOCATION: backend/src/plugins/google-calendar/calendar-api.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Execute Google Calendar REST operations (list, get, create, readback) with target binding.
 *
 * ROLE IN PROJECT:
 *    Adapter performing HTTP event operations against Google Calendar v3 API, enforcing
 *    strict target linkage, private-access masking, and stable readback verification.
 *
 * KEY COMPONENTS:
 *    - CalendarApi: Class implementing CalendarTargetPort and target-bound event execution.
 *    - calendarCreateBody: Builder for single-delivery POST bodies with private linkage.
 *    - projectEvent: Projection of raw Google events into schema with privacy masking.
 * ============================================================================
 */

import type { DiagnosticSink } from '../../chat-runtime/ports.js';
import type { CalendarConnectionBinding, CalendarTargetPort } from '../../contracts/calendar-connections.js';
import type { CalendarResolvedTarget } from '../../contracts/calendar-discovery.js';
import type {
  CalendarExecutionBindingV2, CalendarOperation, CalendarOperationV2,
  CalendarRequestKind, CalendarRequestKindV2,
} from '../../contracts/calendar-operations.js';
import {
  calendarResultSchema, calendarResultV2Schema,
  type CalendarResult, type CalendarResultV2,
} from '../../contracts/calendar-tools.js';
import { calendarHttp } from './calendar-api-http.js';
import { CalendarCursor, type CalendarCursorScope } from './calendar-api-cursor.js';
import {
  calendarEventId, compareCalendarTimes, formatCalendarUtc, parseCalendarTimestamp, toolFault,
} from './tools-validation.js';

export type CalendarHttpContextV1 = {
  binding: CalendarConnectionBinding;
  accessToken: string;
  signal: AbortSignal;
  deadlineAt: string;
  consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
};

export type CalendarHttpContextV2 = {
  binding: CalendarExecutionBindingV2;
  target: CalendarResolvedTarget;
  accessToken: string;
  signal: AbortSignal;
  deadlineAt: string;
  consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
};

export type CalendarHttpContext = CalendarHttpContextV1 | CalendarHttpContextV2;

export type CalendarReadResponseV1 = { result: CalendarResult; headers: Headers; fetchedAt: string };
export type CalendarReadResponseV2 = { result: CalendarResultV2; headers: Headers; fetchedAt: string };
export type CalendarReadResponse = CalendarReadResponseV1 | CalendarReadResponseV2;

const EVENT_FIELDS = 'id,summary,start,end,status,htmlLink,description,location,visibility';
const LIST_FIELDS = `timeZone,nextPageToken,items(${EVENT_FIELDS})`;
const WRITE_FIELDS = `${EVENT_FIELDS},extendedProperties/private`;
const READ_TIME_ZONE = 'Etc/UTC';
const PROOF_REVISION = 'google-calendar.events-owned.v1';
const ALLOWED_LINK_HOSTS = new Set(['calendar.google.com', 'www.google.com']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(): never {
  throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID');
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function calendarEventsPath(calendarId: string): string {
  if (!calendarId || ['.', '..'].includes(calendarId) || hasControlCharacter(calendarId)) {
    throw toolFault('policy', 'CALENDAR_TARGET_REQUIRED');
  }
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}

export function calendarEventPath(calendarId: string, eventId: string): string {
  if (!eventId || ['.', '..'].includes(eventId) || hasControlCharacter(eventId)) invalid();
  return `${calendarEventsPath(calendarId)}/${encodeURIComponent(eventId)}`;
}

function listQuery(args: { timeMin: string; timeMax: string; maxResults: number }, token?: string) {
  const query = new URLSearchParams({ timeMin: args.timeMin, timeMax: args.timeMax,
    maxResults: String(args.maxResults), singleEvents: 'true', showDeleted: 'false',
    orderBy: 'startTime', timeZone: READ_TIME_ZONE, fields: LIST_FIELDS });
  if (token !== undefined) query.set('pageToken', token);
  return query;
}

function eventQuery(): URLSearchParams {
  return new URLSearchParams({ timeZone: READ_TIME_ZONE, fields: EVENT_FIELDS });
}

function writeQuery(): URLSearchParams {
  return new URLSearchParams({ sendUpdates: 'none', conferenceDataVersion: '0',
    supportsAttachments: 'false', fields: WRITE_FIELDS });
}

function wallClockDateTime(timeZone: string, epochSeconds: bigint): string | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return null;
  }
  const parts = formatter.formatToParts(new Date(Number(epochSeconds * 1000n)));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? '';
  const wall = `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(wall) ? wall : null;
}

/**
 * Google rejects dateTime+offset together with timeZone. Send the wall clock in
 * the IANA zone instead. Guest flags and eventType are omitted; they are not
 * required and have caused provider 400s.
 */
function googleEventTime(iso: string, timeZone: string): { dateTime: string; timeZone: string } {
  const parsed = parseCalendarTimestamp(iso);
  const wall = parsed ? wallClockDateTime(timeZone, parsed.epochSeconds) : null;
  return { dateTime: wall ?? iso, timeZone };
}

export function calendarCreateBody(operation: CalendarOperation | CalendarOperationV2): Record<string, unknown> {
  const action = operation.action;
  if (!action) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  return {
    id: operation.googleEventId,
    summary: action.summary,
    start: googleEventTime(action.start, action.timeZone),
    end: googleEventTime(action.end, action.timeZone),
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.location === undefined ? {} : { location: action.location }),
    reminders: { useDefault: false },
    guestsCanInviteOthers: false,
    extendedProperties: { private: { aurvinOperationId: operation.operationId,
      aurvinRequestHash: operation.requestHash } },
  };
}

function safeLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (!ALLOWED_LINK_HOSTS.has(url.hostname)) return null;
  if (!url.pathname.includes('/calendar/event')) return null;
  return value;
}

function validZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Projects one Google event onto the read schema. V1 reads are timed-only: a
 * date-only all-day event projects as `null` so a list can omit it and report
 * truncation rather than present a day as a timed instant. V2 reads preserve
 * date-only intervals verbatim (exclusive end) and label them as all-day.
 *
 * For restricted readers (privateAccess: false), private and confidential events
 * have their summary replaced with empty string, link set to null, and description/location omitted.
 */
function projectEvent(item: unknown, privateAccess = true, allowAllDay = false,
  calendarZone: string | null = null): Record<string, unknown> | null {
  if (!isRecord(item)) invalid();
  const eventId = item.id;
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 1024) invalid();
  const start = isRecord(item.start) ? item.start : null;
  const end = isRecord(item.end) ? item.end : null;
  if (!start || !end) invalid();
  let projectedStart: string, projectedEnd: string, projectedZone: string | null = READ_TIME_ZONE;
  let allDay = false;
  if (typeof start.dateTime !== 'string' || typeof end.dateTime !== 'string') {
    if (!allowAllDay && (typeof start.date === 'string' || typeof end.date === 'string')) return null;
    if (!allowAllDay || typeof start.date !== 'string' || typeof end.date !== 'string'
      || start.dateTime !== undefined || end.dateTime !== undefined) invalid();
    const low = parseCalendarTimestamp(`${start.date}T00:00:00Z`);
    const high = parseCalendarTimestamp(`${end.date}T00:00:00Z`);
    if (!low || !high || compareCalendarTimes(low, high) >= 0) invalid();
    projectedStart = start.date; projectedEnd = end.date; allDay = true;
    projectedZone = validZone(calendarZone) ? calendarZone : validZone(start.timeZone) ? start.timeZone : null;
  } else {
    const startZone = typeof start.timeZone === 'string' ? start.timeZone : 'Etc/UTC';
    const endZone = typeof end.timeZone === 'string' ? end.timeZone : startZone;
    const low = parseFlexibleDateTime(start.dateTime, startZone);
    const high = parseFlexibleDateTime(end.dateTime, endZone);
    if (!low || !high || compareCalendarTimes(low, high) >= 0) invalid();
    projectedStart = formatCalendarUtc(low); projectedEnd = formatCalendarUtc(high);
  }
  const status = item.status === undefined ? 'confirmed' : item.status;
  if (status !== 'confirmed' && status !== 'tentative' && status !== 'cancelled') invalid();

  const isPrivateMasked = !privateAccess && (item.visibility === 'private' || item.visibility === 'confidential');

  const event: Record<string, unknown> = {
    eventId,
    summary: isPrivateMasked ? '' : (typeof item.summary === 'string' ? item.summary : ''),
    start: projectedStart,
    end: projectedEnd,
    timeZone: projectedZone,
    ...(allDay ? { allDay: true } : {}),
    status,
    htmlLink: isPrivateMasked ? null : safeLink(item.htmlLink),
  };
  if (!isPrivateMasked) {
    if (typeof item.description === 'string') event.description = item.description;
    if (typeof item.location === 'string') event.location = item.location;
  }
  return event;
}

function calendarResult(value: unknown): CalendarResult {
  const parsed = calendarResultSchema.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data;
}

function isV2Context(context: CalendarHttpContext): context is CalendarHttpContextV2 {
  return 'target' in context && context.target !== null && context.target !== undefined;
}

function assertOperationLinkageV1(context: CalendarHttpContextV1, operation: CalendarOperation): void {
  const binding = context.binding;
  if (operation.connectionId !== binding.connectionId
    || operation.connectionRevision !== binding.connectionRevision
    || operation.googleSubjectId !== binding.googleSubjectId
    || operation.calendarId !== binding.calendarId
    || operation.targetRevision !== binding.targetRevision) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
}

function assertCreateLinkageV1(context: CalendarHttpContextV1, operation: CalendarOperation): void {
  assertOperationLinkageV1(context, operation);
  if (operation.state !== 'dispatching') {
    throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  }
  if (operation.action === null) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
}

function assertReadbackLinkageV1(context: CalendarHttpContextV1, operation: CalendarOperation): void {
  assertOperationLinkageV1(context, operation);
  if (operation.state !== 'dispatching' && operation.state !== 'unknown'
    && operation.state !== 'succeeded') {
    throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  }
  if (operation.action === null) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
}

function assertCreateLinkageV2(context: CalendarHttpContextV2, operation: CalendarOperationV2): void {
  const binding = context.binding;
  const target = context.target;
  if (operation.connectionId !== binding.connectionId
    || operation.connectionRevision !== binding.connectionRevision
    || operation.googleSubjectId !== binding.googleSubjectId
    || operation.calendarId !== target.calendarId
    || operation.targetRevision !== target.targetRevision) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
  if (target.userId !== binding.userId
    || target.connectionId !== binding.connectionId
    || target.connectionRevision !== binding.connectionRevision
    || target.googleSubjectId !== binding.googleSubjectId) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
  if (!target.capabilities.createEvents) {
    throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
  }
  if (operation.state !== 'dispatching') {
    throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  }
  if (operation.action === null) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  if (operation.action.calendarId !== undefined && operation.action.calendarId !== target.calendarId) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
  if (operation.schemaRevision !== 'google-calendar.v2' || operation.proofRevision !== 'google-calendar.multi.v2') {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
  if (operation.googleEventId !== calendarEventId(operation.operationId)) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
}

function assertReadbackLinkageV2(context: CalendarHttpContextV2, operation: CalendarOperationV2): void {
  const binding = context.binding;
  const target = context.target;
  if (operation.connectionId !== binding.connectionId
    || operation.connectionRevision !== binding.connectionRevision
    || operation.googleSubjectId !== binding.googleSubjectId
    || operation.calendarId !== target.calendarId
    || operation.targetRevision !== target.targetRevision) {
    throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
  }
  if (operation.state !== 'dispatching' && operation.state !== 'unknown'
    && operation.state !== 'succeeded') {
    throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  }
  if (operation.action === null) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
}

function zoneOffsetSeconds(timeZone: string, epochSeconds: bigint): number | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch {
    return null;
  }
  const parts = formatter.formatToParts(new Date(Number(epochSeconds * 1000n)));
  const numbers: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') numbers[part.type] = Number(part.value);
  if (![numbers.year, numbers.month, numbers.day, numbers.hour, numbers.minute, numbers.second]
    .every((part) => Number.isFinite(part))) return null;
  const probe = new Date(0);
  probe.setUTCFullYear(numbers.year, numbers.month - 1, numbers.day);
  probe.setUTCHours(numbers.hour, numbers.minute, numbers.second, 0);
  return Number(BigInt(probe.getTime()) / 1000n - epochSeconds);
}

function sameZoneOffset(left: string, right: string, epochSeconds: bigint): boolean {
  const leftOffset = zoneOffsetSeconds(left, epochSeconds);
  const rightOffset = zoneOffsetSeconds(right, epochSeconds);
  return leftOffset !== null && rightOffset !== null && leftOffset === rightOffset;
}

function parseFlexibleDateTime(dateTime: string, timeZone: string): ReturnType<typeof parseCalendarTimestamp> {
  const offset = parseCalendarTimestamp(dateTime);
  if (offset) return offset;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(dateTime)) return null;
  const asUtc = parseCalendarTimestamp(`${dateTime}Z`);
  if (!asUtc) return null;
  let epoch = asUtc.epochSeconds;
  for (let step = 0; step < 2; step += 1) {
    const shown = zoneOffsetSeconds(timeZone, epoch);
    if (shown === null) return null;
    epoch = asUtc.epochSeconds - BigInt(shown);
  }
  const adjusted = parseCalendarTimestamp(new Date(Number(epoch * 1000n)).toISOString());
  if (!adjusted || wallClockDateTime(timeZone, adjusted.epochSeconds) !== dateTime) return null;
  return adjusted;
}

function sameEventInstant(
  expected: NonNullable<ReturnType<typeof parseCalendarTimestamp>>,
  dateTime: string,
  responseZone: string | null,
  actionZone: string,
): boolean {
  const parsed = parseFlexibleDateTime(dateTime, responseZone ?? actionZone);
  return parsed !== null && compareCalendarTimes(expected, parsed) === 0;
}

/**
 * A create or readback only counts when the stored event carries the persisted
 * id, the same action and both private linkage values.
 */
function matchesCreateAction(
  body: Record<string, unknown>,
  operation: CalendarOperation | CalendarOperationV2,
): boolean {
  const action = operation.action;
  if (!action) return false;
  if (body.id !== operation.googleEventId) return false;
  if (body.status === 'cancelled') return false;
  if (body.summary !== action.summary) return false;
  const start = isRecord(body.start) ? body.start : null;
  const end = isRecord(body.end) ? body.end : null;
  if (!start || !end || typeof start.dateTime !== 'string' || typeof end.dateTime !== 'string') return false;
  const expectedStart = parseCalendarTimestamp(action.start);
  const expectedEnd = parseCalendarTimestamp(action.end);
  if (!expectedStart || !expectedEnd) return false;
  if (!sameEventInstant(expectedStart, start.dateTime, typeof start.timeZone === 'string' ? start.timeZone : null,
    action.timeZone)) return false;
  if (!sameEventInstant(expectedEnd, end.dateTime, typeof end.timeZone === 'string' ? end.timeZone : null,
    action.timeZone)) return false;
  const responseZone = typeof start.timeZone === 'string' ? start.timeZone : null;
  if (responseZone !== null && typeof end.timeZone === 'string'
    && !sameZoneOffset(action.timeZone, end.timeZone, expectedEnd.epochSeconds)) return false;
  if ((body.description ?? undefined) !== (action.description ?? undefined)) return false;
  if ((body.location ?? undefined) !== (action.location ?? undefined)) return false;
  const properties = isRecord(body.extendedProperties) ? body.extendedProperties : null;
  const priv = properties && isRecord(properties.private) ? properties.private : null;
  if (!priv) return false;
  return priv.aurvinOperationId === operation.operationId
    && priv.aurvinRequestHash === operation.requestHash;
}

export class CalendarApi implements CalendarTargetPort {
  private readonly fetcher: typeof fetch;
  private readonly cursor: CalendarCursor;
  private readonly now: () => number;
  private readonly diagnostic: DiagnosticSink | undefined;

  constructor(options: { fetcher?: typeof fetch; cursorKey?: Uint8Array; now?: () => number;
    diagnostic?: DiagnosticSink } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.diagnostic = options.diagnostic;
    this.cursor = new CalendarCursor(options.cursorKey, options.now, this.diagnostic);
    this.now = options.now ?? (() => Date.now());
  }

  async list(
    context: CalendarHttpContextV2,
    args: { calendarId?: string; timeMin: string; timeMax: string; maxResults: number; pageToken?: string },
  ): Promise<CalendarReadResponseV2>;
  async list(
    context: CalendarHttpContextV1,
    args: { timeMin: string; timeMax: string; maxResults: number; pageToken?: string },
  ): Promise<CalendarReadResponseV1>;
  async list(
    context: CalendarHttpContext,
    args: { calendarId?: string; timeMin: string; timeMax: string; maxResults: number; pageToken?: string },
  ): Promise<CalendarReadResponse> {
    if (isV2Context(context)) {
      if (context.target.userId !== context.binding.userId
        || context.target.connectionId !== context.binding.connectionId
        || context.target.connectionRevision !== context.binding.connectionRevision
        || context.target.googleSubjectId !== context.binding.googleSubjectId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      if (args.calendarId !== undefined && args.calendarId !== context.target.calendarId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      if (!context.target.capabilities.readEvents) {
        throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
      }
      const cursorScope: CalendarCursorScope = {
        kind: 'events',
        discoveryRevision: context.target.discoveryRevision,
        expiresAt: new Date(Date.parse(context.target.verifiedAt) + 300000).toISOString(),
      };
      const providerToken = args.pageToken === undefined
        ? undefined : this.cursor.decode(args.pageToken, context.target, args, cursorScope);
      const response = await calendarHttp({
        fetcher: this.fetcher,
        path: calendarEventsPath(context.target.calendarId),
        method: 'GET',
        query: listQuery(args, providerToken),
        accessToken: context.accessToken,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
        consumeRequest: () => context.consumeRequest('list'),
        now: this.now,
        diagnostic: this.diagnostic,
        requestKind: 'list',
      });
      if (!isRecord(response.body)) invalid();
      if (!validZone(response.body.timeZone)) invalid();
      const items = response.body.items;
      if (!Array.isArray(items)) invalid();
      if (items.length > args.maxResults || items.length > 20) invalid();
      const events: Record<string, unknown>[] = [];
      let omitted = false;
      for (const item of items) {
        const projected = projectEvent(item, context.target.privateAccess, true, response.body.timeZone);
        if (projected === null) { omitted = true; continue; }
        events.push(projected);
      }
      const nextProviderToken = response.body.nextPageToken;
      let nextPageToken: string | null = null;
      if (nextProviderToken !== undefined && nextProviderToken !== null) {
        if (typeof nextProviderToken !== 'string' || nextProviderToken.length === 0) invalid();
        nextPageToken = this.cursor.encode(nextProviderToken, context.target, args, cursorScope);
      }
      const resultTarget = {
        calendarId: context.target.calendarId,
        calendarLabel: context.target.calendarLabel,
        discoveryRevision: context.target.discoveryRevision,
        privateAccess: context.target.privateAccess,
      };
      const result = calendarResultV2Schema.parse({
        schemaVersion: 2,
        tool: 'calendar_list_events',
        target: resultTarget,
        events,
        nextPageToken,
        truncated: omitted || nextPageToken !== null,
      });
      return { result, headers: response.headers, fetchedAt: response.fetchedAt };
    }

    // V1 context
    const providerToken = args.pageToken === undefined
      ? undefined : this.cursor.decodeLegacy(args.pageToken, context.binding, args);
    const response = await calendarHttp({
      fetcher: this.fetcher,
      path: calendarEventsPath(context.binding.calendarId),
      method: 'GET',
      query: listQuery(args, providerToken),
      accessToken: context.accessToken,
      signal: context.signal,
      deadlineAt: context.deadlineAt,
      consumeRequest: () => context.consumeRequest('list'),
      now: this.now,
      diagnostic: this.diagnostic,
      requestKind: 'list',
    });
    if (!isRecord(response.body)) invalid();
    if (!validZone(response.body.timeZone)) invalid();
    const items = response.body.items;
    if (!Array.isArray(items)) invalid();
    if (items.length > args.maxResults || items.length > 20) invalid();
    const events: Record<string, unknown>[] = [];
    let omitted = false;
    for (const item of items) {
      const projected = projectEvent(item);
      if (projected === null) { omitted = true; continue; }
      events.push(projected);
    }
    const nextProviderToken = response.body.nextPageToken;
    let nextPageToken: string | null = null;
    if (nextProviderToken !== undefined && nextProviderToken !== null) {
      if (typeof nextProviderToken !== 'string' || nextProviderToken.length === 0) invalid();
      nextPageToken = nextProviderToken;
    }
    const result = calendarResult({
      tool: 'calendar_list_events', events, nextPageToken,
      truncated: omitted || nextPageToken !== null,
    });
    return { result, headers: response.headers, fetchedAt: response.fetchedAt };
  }

  async get(
    context: CalendarHttpContextV2,
    args: { calendarId?: string; eventId: string },
  ): Promise<CalendarReadResponseV2>;
  async get(
    context: CalendarHttpContextV1,
    args: { eventId: string },
  ): Promise<CalendarReadResponseV1>;
  async get(
    context: CalendarHttpContext,
    args: { calendarId?: string; eventId: string },
  ): Promise<CalendarReadResponse> {
    if (isV2Context(context)) {
      if (context.target.userId !== context.binding.userId
        || context.target.connectionId !== context.binding.connectionId
        || context.target.connectionRevision !== context.binding.connectionRevision
        || context.target.googleSubjectId !== context.binding.googleSubjectId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      if (args.calendarId !== undefined && args.calendarId !== context.target.calendarId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      if (!context.target.capabilities.readEvents) {
        throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
      }
      const response = await calendarHttp({
        fetcher: this.fetcher,
        path: calendarEventPath(context.target.calendarId, args.eventId),
        method: 'GET',
        query: eventQuery(),
        accessToken: context.accessToken,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
        consumeRequest: () => context.consumeRequest('get'),
        now: this.now,
        diagnostic: this.diagnostic,
        requestKind: 'get',
      });
      if (!isRecord(response.body)) invalid();
      if (response.body.id !== args.eventId) invalid();
      const projected = projectEvent(response.body, context.target.privateAccess, true);
      if (projected === null) throw toolFault('delivery', 'CALENDAR_UNSUPPORTED_CONTENT');
      const resultTarget = {
        calendarId: context.target.calendarId,
        calendarLabel: context.target.calendarLabel,
        discoveryRevision: context.target.discoveryRevision,
        privateAccess: context.target.privateAccess,
      };
      const result = calendarResultV2Schema.parse({
        schemaVersion: 2,
        tool: 'calendar_get_event',
        target: resultTarget,
        event: projected,
      });
      return { result, headers: response.headers, fetchedAt: response.fetchedAt };
    }

    // V1 context
    const response = await calendarHttp({
      fetcher: this.fetcher,
      path: calendarEventPath(context.binding.calendarId, args.eventId),
      method: 'GET',
      query: eventQuery(),
      accessToken: context.accessToken,
      signal: context.signal,
      deadlineAt: context.deadlineAt,
      consumeRequest: () => context.consumeRequest('get'),
      now: this.now,
      diagnostic: this.diagnostic,
      requestKind: 'get',
    });
    if (!isRecord(response.body)) invalid();
    if (response.body.id !== args.eventId) invalid();
    const projected = projectEvent(response.body);
    if (projected === null) throw toolFault('delivery', 'CALENDAR_UNSUPPORTED_CONTENT');
    const result = calendarResult({ tool: 'calendar_get_event', event: projected });
    return { result, headers: response.headers, fetchedAt: response.fetchedAt };
  }

  async create(
    context: CalendarHttpContextV2,
    operation: CalendarOperationV2,
  ): Promise<CalendarReadResponseV2>;
  async create(
    context: CalendarHttpContextV1,
    operation: CalendarOperation,
  ): Promise<CalendarReadResponseV1>;
  async create(
    context: CalendarHttpContext,
    operation: CalendarOperation | CalendarOperationV2,
  ): Promise<CalendarReadResponse> {
    if (isV2Context(context)) {
      if (operation.schemaRevision !== 'google-calendar.v2') {
        throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
      }
      assertCreateLinkageV2(context, operation as CalendarOperationV2);
      const response = await calendarHttp({
        fetcher: this.fetcher,
        path: calendarEventsPath(context.target.calendarId),
        method: 'POST',
        query: writeQuery(),
        body: calendarCreateBody(operation),
        accessToken: context.accessToken,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
        consumeRequest: () => context.consumeRequest('create'),
        write: true,
        now: this.now,
        diagnostic: this.diagnostic,
        requestKind: 'create',
      });
      if (!isRecord(response.body)) throw toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
      let projected: Record<string, unknown> | null;
      try { projected = projectEvent(response.body, context.target.privateAccess); }
      catch { throw toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback'); }
      if (projected === null) throw toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
      if (!matchesCreateAction(response.body, operation)) {
        throw toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
      }
      const resultTarget = {
        calendarId: context.target.calendarId,
        calendarLabel: context.target.calendarLabel,
        discoveryRevision: context.target.discoveryRevision,
        privateAccess: context.target.privateAccess,
      };
      const result = calendarResultV2Schema.parse({
        schemaVersion: 2,
        tool: 'calendar_create_event',
        target: resultTarget,
        event: projected,
      });
      return { result, headers: response.headers, fetchedAt: response.fetchedAt };
    }

    // V1 create is denied
    throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
  }

  async readback(
    context: CalendarHttpContextV2,
    operation: CalendarOperationV2,
  ): Promise<{ outcome: 'matched'; response: CalendarReadResponseV2 } | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  async readback(
    context: CalendarHttpContextV1,
    operation: CalendarOperation,
  ): Promise<{ outcome: 'matched'; response: CalendarReadResponseV1 } | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  async readback(
    context: CalendarHttpContext,
    operation: CalendarOperation | CalendarOperationV2,
  ): Promise<{ outcome: 'matched'; response: CalendarReadResponse } | { outcome: 'absent' | 'mismatch' | 'unknown' }> {
    if (isV2Context(context)) {
      if (operation.schemaRevision !== 'google-calendar.v2') {
        throw toolFault('policy', 'OPERATION_AUTHORITY_MISMATCH');
      }
      assertReadbackLinkageV2(context, operation as CalendarOperationV2);
      let response: CalendarReadResponseV2;
      try {
        const raw = await calendarHttp({
          fetcher: this.fetcher,
          path: calendarEventPath(context.target.calendarId, operation.googleEventId),
          method: 'GET',
          query: new URLSearchParams({ timeZone: READ_TIME_ZONE, fields: WRITE_FIELDS }),
          accessToken: context.accessToken,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
          consumeRequest: () => context.consumeRequest('readback'),
          now: this.now,
          diagnostic: this.diagnostic,
          requestKind: 'readback',
        });
        if (!isRecord(raw.body)) return { outcome: 'unknown' };
        const projected = projectEvent(raw.body, context.target.privateAccess);
        if (projected === null) return { outcome: 'mismatch' };
        if (!matchesCreateAction(raw.body, operation)) return { outcome: 'mismatch' };
        const resultTarget = {
          calendarId: context.target.calendarId,
          calendarLabel: context.target.calendarLabel,
          discoveryRevision: context.target.discoveryRevision,
          privateAccess: context.target.privateAccess,
        };
        const result = calendarResultV2Schema.parse({
          schemaVersion: 2,
          tool: 'calendar_create_event',
          target: resultTarget,
          event: projected,
        });
        response = { result, headers: raw.headers, fetchedAt: raw.fetchedAt };
      } catch (error) {
        const failure = error instanceof Error && 'failure' in error
          ? (error as { failure?: { code?: string } }).failure : undefined;
        if (failure?.code === 'EVENT_NOT_FOUND' || failure?.code === 'EVENT_GONE') {
          return { outcome: 'absent' };
        }
        return { outcome: 'unknown' };
      }
      return { outcome: 'matched', response };
    }

    // V1 readback
    assertReadbackLinkageV1(context, operation as CalendarOperation);
    let response: CalendarReadResponseV1;
    try {
      const raw = await calendarHttp({
        fetcher: this.fetcher,
        path: calendarEventPath(context.binding.calendarId, operation.googleEventId),
        method: 'GET',
        query: new URLSearchParams({ timeZone: READ_TIME_ZONE, fields: WRITE_FIELDS }),
        accessToken: context.accessToken,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
        consumeRequest: () => context.consumeRequest('readback'),
        now: this.now,
        diagnostic: this.diagnostic,
        requestKind: 'readback',
      });
      if (!isRecord(raw.body)) return { outcome: 'unknown' };
      const projected = projectEvent(raw.body);
      if (projected === null) return { outcome: 'mismatch' };
      if (!matchesCreateAction(raw.body, operation)) return { outcome: 'mismatch' };
      response = { result: calendarResult({ tool: 'calendar_create_event', event: projected }),
        headers: raw.headers, fetchedAt: raw.fetchedAt };
    } catch (error) {
      const failure = error instanceof Error && 'failure' in error
        ? (error as { failure?: { code?: string } }).failure : undefined;
      if (failure?.code === 'EVENT_NOT_FOUND' || failure?.code === 'EVENT_GONE') {
        return { outcome: 'absent' };
      }
      return { outcome: 'unknown' };
    }
    return { outcome: 'matched', response };
  }

  async verifyOwnedTarget(input: { calendarId: string; googleSubjectId: string; accessToken: string;
    signal: AbortSignal; deadlineAt: string; consumeRequest: () => Promise<void> }): Promise<{
      calendarId: string; googleSubjectId: string; verifiedAt: string; proofRevision: string }> {
    if (!input.googleSubjectId) throw toolFault('policy', 'CALENDAR_TARGET_REQUIRED');
    const query = new URLSearchParams({ maxResults: '1', singleEvents: 'true',
      showDeleted: 'false', timeZone: READ_TIME_ZONE, fields: 'accessRole,timeZone' });
    const response = await calendarHttp({
      fetcher: this.fetcher,
      path: calendarEventsPath(input.calendarId),
      method: 'GET',
      query,
      accessToken: input.accessToken,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      consumeRequest: async () => { await input.consumeRequest(); },
      now: this.now,
      diagnostic: this.diagnostic,
      requestKind: 'capability-recheck',
    });
    if (!isRecord(response.body)) invalid();
    if (response.body.accessRole !== 'owner') {
      throw toolFault('policy', 'CALENDAR_TARGET_NOT_OWNED');
    }
    if (!validZone(response.body.timeZone)) invalid();
    return { calendarId: input.calendarId, googleSubjectId: input.googleSubjectId,
      verifiedAt: response.fetchedAt, proofRevision: PROOF_REVISION };
  }
}
