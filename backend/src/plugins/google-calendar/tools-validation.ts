import { createHash } from 'node:crypto';
import { CALENDAR_LIMITS, calendarFailureSchema, type CalendarFailure, type CalendarLimits }
  from '../../contracts/calendar-policy.js';
import { CALENDAR_TOOLS, calendarCallSchema, calendarInputSchemas, forbiddenCalendarKeys, jsonBytes,
  type CalendarCall, type CalendarCreateInput } from '../../contracts/calendar-tools.js';
import { operationRecordSchema, operationRecordV2Schema, calendarExecutionBindingV2Schema,
  type CalendarExecutionBinding, type CalendarExecutionBindingV2, type CalendarOperation,
  type CalendarOperationV2 } from '../../contracts/calendar-operations.js';
import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';

export const CALENDAR_ARGUMENTS_INVALID = 'CALENDAR_ARGUMENTS_INVALID';
export const CALENDAR_FORBIDDEN = 'CALENDAR_FORBIDDEN';
export const CALENDAR_UNKNOWN_TOOL = 'CALENDAR_UNKNOWN_TOOL';
export const TIME_REQUIRES_CLARIFICATION = 'TIME_REQUIRES_CLARIFICATION';
export const SUMMARY_REQUIRES_CLARIFICATION = 'SUMMARY_REQUIRES_CLARIFICATION';
export const OPERATION_AUTHORITY_REQUIRED = 'OPERATION_AUTHORITY_REQUIRED';

const ALLOWED_TOOL_NAMES: readonly string[] = CALENDAR_TOOLS.map(t => t.name);
const FORBIDDEN_KEYS = new Set<string>(forbiddenCalendarKeys);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/u;

export class CalendarToolFault extends Error {
  readonly failure: CalendarFailure;

  constructor(failure: CalendarFailure) {
    super(failure.code);
    this.name = 'CalendarToolFault';
    this.failure = failure;
  }
}

export function toolFault(category: CalendarFailure['category'], code: string,
  retry: CalendarFailure['retry'] = 'none'): CalendarToolFault {
  return new CalendarToolFault(calendarFailureSchema.parse({ category, code, retry }));
}

export type CalendarTimestamp = {
  epochSeconds: bigint;
  fraction: string;
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  offsetMinutes: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseCalendarTimestamp(value: string): CalendarTimestamp | null {
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const fraction = match[7] ?? '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (!match[8]) {
    const offsetHours = Number(match[10]); const offsetRest = Number(match[11]);
    if (offsetHours > 23 || offsetRest > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetRest) * (match[9] === '-' ? -1 : 1);
    if (offsetMinutes === 0 && match[9] === '-') return null;
  }
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(hour, minute, second, 0);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day) return null;
  const epochMs = probe.getTime() - offsetMinutes * 60000;
  if (!Number.isFinite(epochMs)) return null;
  return { epochSeconds: BigInt(epochMs) / 1000n, fraction, year, month, day,
    hour, minute, second, offsetMinutes };
}

export function compareCalendarTimes(left: CalendarTimestamp, right: CalendarTimestamp): number {
  if (left.epochSeconds < right.epochSeconds) return -1;
  if (left.epochSeconds > right.epochSeconds) return 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  if (width === 0) return 0;
  const leftDigits = left.fraction.padEnd(width, '0');
  const rightDigits = right.fraction.padEnd(width, '0');
  if (leftDigits === rightDigits) return 0;
  return leftDigits < rightDigits ? -1 : 1;
}

export function formatCalendarUtc(value: CalendarTimestamp): string {
  const iso = new Date(Number(value.epochSeconds * 1000n)).toISOString();
  return `${iso.slice(0, -5)}${value.fraction ? `.${value.fraction}` : ''}Z`;
}

function fractionExceeds(seconds: number, upper: CalendarTimestamp, lower: CalendarTimestamp): boolean {
  const width = Math.max(upper.fraction.length, lower.fraction.length);
  if (width === 0) return false;
  const upperDigits = upper.fraction.padEnd(width, '0');
  const lowerDigits = lower.fraction.padEnd(width, '0');
  return upperDigits > lowerDigits;
}

function exceedsWindow(upper: CalendarTimestamp, lower: CalendarTimestamp, seconds: number): boolean {
  const difference = upper.epochSeconds - lower.epochSeconds;
  if (difference > BigInt(seconds)) return true;
  if (difference < BigInt(seconds)) return false;
  return fractionExceeds(seconds, upper, lower);
}

function zoneWallClock(timeZone: string, value: CalendarTimestamp):
  { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch {
    return null;
  }
  const parts = formatter.formatToParts(new Date(Number(value.epochSeconds * 1000n)));
  const numbers: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') numbers[part.type] = Number(part.value);
  if (![numbers.year, numbers.month, numbers.day, numbers.hour, numbers.minute, numbers.second]
    .every((part) => Number.isFinite(part))) return null;
  return { year: numbers.year, month: numbers.month, day: numbers.day,
    hour: numbers.hour, minute: numbers.minute, second: numbers.second };
}

function observeSemantic(diagnostic: DiagnosticSink | undefined, fields: Readonly<Record<string, unknown>>): void {
  diagnose(diagnostic, {
    stage: 'validation', state: 'rejected', origin: 'local', delivery: 'not-sent', ...fields,
  });
}

function assertZoneConsistent(timeZone: string, value: CalendarTimestamp,
  diagnostic?: DiagnosticSink): void {
  const wall = zoneWallClock(timeZone, value);
  if (!wall) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeZone', expected: 'string',
      constraint: 'iana-zone', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (wall.year !== value.year || wall.month !== value.month || wall.day !== value.day
    || wall.hour !== value.hour || wall.minute !== value.minute || wall.second !== value.second) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeZone', expected: 'string',
      constraint: 'iana-zone', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
}

function assertDepthWithin(value: unknown, maxDepth: number): void {
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (isRecord(node)) for (const item of Object.values(node)) walk(item, depth + 1);
  };
  walk(value, 1);
}

function assertNoForbiddenKeys(value: unknown): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (!isRecord(node)) return;
    for (const [key, item] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key)) throw toolFault('policy', CALENDAR_FORBIDDEN);
      walk(item);
    }
  };
  walk(value);
}

export function calendarActionHash(value: CalendarCreateInput): string {
  const input = calendarInputSchemas.calendar_create_event.parse(value);
  const canonical = JSON.stringify({
    ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
    summary: input.summary, start: input.start, end: input.end, timeZone: input.timeZone,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location }) });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function calendarEventId(operationId: string): string {
  return createHash('sha256').update(`aurvin.google-calendar.v1:${operationId}`, 'utf8').digest('hex');
}

function validateListArguments(arguments_: { timeMin: string; timeMax: string },
  limits: CalendarLimits, diagnostic?: DiagnosticSink): void {
  const minimum = parseCalendarTimestamp(arguments_.timeMin);
  const maximum = parseCalendarTimestamp(arguments_.timeMax);
  if (!minimum) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeMin', expected: 'string',
      constraint: 'rfc3339', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (!maximum) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeMax', expected: 'string',
      constraint: 'rfc3339', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (compareCalendarTimes(maximum, minimum) <= 0) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeMax', expected: 'string',
      constraint: 'time-order', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (exceedsWindow(maximum, minimum, limits.listDays * 86400)) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeMax', expected: 'string',
      constraint: 'max-window', suppliedType: 'string', presence: 'present',
      limit: limits.listDays, code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validateGetArguments(arguments_: { eventId: string }, diagnostic?: DiagnosticSink,
  field: 'eventId' | 'calendarId' | 'calendarIds' = 'eventId'): void {
  if (arguments_.eventId.length === 0) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field, expected: 'string',
      constraint: 'valid-id', suppliedType: 'string', presence: 'present',
      code: CALENDAR_ARGUMENTS_INVALID });
    throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
  }
  if (hasControlCharacter(arguments_.eventId) || arguments_.eventId === '.'
    || arguments_.eventId === '..') {
    observeSemantic(diagnostic, { reason: 'invalid-value', field, expected: 'string',
      constraint: 'valid-id', suppliedType: 'string', presence: 'present',
      code: CALENDAR_ARGUMENTS_INVALID });
    throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
  }
}

function validateCreateArguments(arguments_: CalendarCreateInput, diagnostic?: DiagnosticSink): void {
  if (arguments_.summary.trim().length === 0) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'summary', expected: 'string',
      suppliedType: 'string', presence: 'present', code: SUMMARY_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', SUMMARY_REQUIRES_CLARIFICATION);
  }
  const start = parseCalendarTimestamp(arguments_.start);
  const end = parseCalendarTimestamp(arguments_.end);
  if (!start) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'start', expected: 'string',
      constraint: 'rfc3339', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (!end) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'end', expected: 'string',
      constraint: 'rfc3339', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  if (compareCalendarTimes(end, start) <= 0) {
    observeSemantic(diagnostic, { reason: 'invalid-value', field: 'end', expected: 'string',
      constraint: 'time-order', suppliedType: 'string', presence: 'present',
      code: TIME_REQUIRES_CLARIFICATION });
    throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
  }
  assertZoneConsistent(arguments_.timeZone, start, diagnostic);
  assertZoneConsistent(arguments_.timeZone, end, diagnostic);
}

export function validateCalendarCall(value: unknown, limits: CalendarLimits = CALENDAR_LIMITS,
  diagnostic?: DiagnosticSink): CalendarCall {
  assertDepthWithin(value, limits.jsonDepth);
  const argumentsBytes = isRecord(value) && isRecord(value.arguments)
    ? jsonBytes(value.arguments) : jsonBytes(value ?? null);
  if (argumentsBytes > limits.argumentBytes) {
    throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
  }
  assertNoForbiddenKeys(value);
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
  }
  if (!ALLOWED_TOOL_NAMES.includes(value.name)) {
    throw toolFault('policy', CALENDAR_UNKNOWN_TOOL);
  }
  const parsed = calendarCallSchema.safeParse(value);
  if (!parsed.success) throw toolFault('structural', CALENDAR_ARGUMENTS_INVALID, 'schema-repair');
  const call = parsed.data;
  if ('calendarId' in call.arguments && call.arguments.calendarId !== undefined) {
    validateGetArguments({ eventId: call.arguments.calendarId }, diagnostic, 'calendarId');
  }
  if (call.name === 'calendar_list_events' || call.name === 'calendar_check_availability') {
    validateListArguments(call.arguments, limits, diagnostic);
  }
  if (call.name === 'calendar_check_availability') {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: call.arguments.timeZone }); }
    catch {
      observeSemantic(diagnostic, { reason: 'invalid-value', field: 'timeZone', expected: 'string',
        constraint: 'iana-zone', suppliedType: 'string', presence: 'present',
        code: TIME_REQUIRES_CLARIFICATION });
      throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
    }
    for (const id of call.arguments.calendarIds ?? []) {
      validateGetArguments({ eventId: id }, diagnostic, 'calendarIds');
    }
  } else if (call.name === 'calendar_get_event') validateGetArguments(call.arguments, diagnostic, 'eventId');
  else if (call.name === 'calendar_create_event') validateCreateArguments(call.arguments, diagnostic);
  return call;
}

export function requireCreateAuthority(
  binding: CalendarExecutionBindingV2,
  action: CalendarCreateInput,
  nowMs?: number,
): CalendarOperationV2;
export function requireCreateAuthority(
  binding: CalendarExecutionBinding,
  action: CalendarCreateInput,
  nowMs?: number,
): CalendarOperation;
export function requireCreateAuthority(
  binding: CalendarExecutionBinding | CalendarExecutionBindingV2,
  action: CalendarCreateInput,
  nowMs = Date.now(),
): CalendarOperation | CalendarOperationV2 {
  if (binding.schemaRevision !== 'google-calendar.v2') {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }
  const parsedBinding = calendarExecutionBindingV2Schema.safeParse(binding);
  if (!parsedBinding.success) throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  const bound = parsedBinding.data;

  if (!bound.target || !bound.operation) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }
  if (!bound.target.capabilities.createEvents) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  const record = bound.operation;
  if (record.state !== 'dispatching' || record.action === null) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  const trustedNow = Date.parse(bound.trustedNow);
  const deadline = Date.parse(bound.deadlineAt);
  if (!Number.isFinite(trustedNow) || !Number.isFinite(deadline)) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  const evalClock = Math.max(trustedNow, nowMs);
  if (Date.parse(record.auditExpiresAt) <= evalClock) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (record.userId !== bound.userId || record.sessionId !== bound.sessionId
    || record.turnId !== bound.turnId) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (record.connectionId !== bound.connectionId
    || record.connectionRevision !== bound.connectionRevision
    || record.targetRevision !== bound.target.targetRevision
    || record.googleSubjectId !== bound.googleSubjectId
    || record.calendarId !== bound.target.calendarId) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (bound.target.userId !== bound.userId
    || bound.target.connectionId !== bound.connectionId
    || bound.target.connectionRevision !== bound.connectionRevision
    || bound.target.googleSubjectId !== bound.googleSubjectId) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (record.schemaRevision !== 'google-calendar.v2'
    || bound.schemaRevision !== 'google-calendar.v2'
    || record.proofRevision !== 'google-calendar.multi.v2'
    || bound.target.proofRevision !== 'google-calendar.multi.v2') {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  const canonicalAction = action.calendarId === undefined
    ? { ...action, calendarId: bound.target.calendarId }
    : action;

  if (canonicalAction.calendarId !== bound.target.calendarId
    || record.calendarId !== bound.target.calendarId
    || record.action.calendarId !== bound.target.calendarId) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  let operationHash: string;
  let actionHash: string;
  try {
    operationHash = calendarActionHash(record.action);
    actionHash = calendarActionHash(canonicalAction);
  } catch {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (operationHash !== record.requestHash
    || operationHash !== record.authorization.canonicalActionHash
    || actionHash !== operationHash) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  if (!/^[0-9a-v]{5,1024}$/.test(record.googleEventId)
    || record.googleEventId !== calendarEventId(record.operationId)) {
    throw toolFault('policy', OPERATION_AUTHORITY_REQUIRED);
  }

  return record;
}
