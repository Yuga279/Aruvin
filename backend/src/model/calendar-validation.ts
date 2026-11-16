/**
 * ============================================================================
 * FILE: calendar-validation.ts
 * LOCATION: backend/src/model/calendar-validation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate model tool-call candidates and generate bounded repair diagnostics.
 *
 * ROLE IN PROJECT:
 *    Inspects streamed OpenRouter candidate calls, checks tool names, JSON safety,
 *    field boundaries, and emits diagnostics for structured model repairs.
 *
 * KEY COMPONENTS:
 *    - validateCalendarCandidate: Validates raw model tool calls against CALENDAR_TOOLS.
 *    - normalizeDiagnostics: Enforces diagnostic path boundaries, counts, and char caps.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import type { ZodIssue, z } from 'zod';
import { idSchema } from '../contracts/identifiers.js';
import { calendarFailureSchema, type CalendarFailure, type CalendarLimits } from '../contracts/calendar-policy.js';
import { activateSkillEnvelopeSchema, callToolEnvelopeSchema,
  type ActivateSkillEnvelope, type CallToolEnvelope, type SkillNativeDefinition } from '../contracts/calendar-tools.js';
import { nativeToolCallSchema, repairDiagnosticsSchema,
  type CalendarRepairDiagnostics } from '../contracts/calendar-model.js';
import { diagnose, type DiagnosticSink } from '../chat-runtime/ports.js';
import { scanJsonObject } from './strict-json.js';

export type CandidateCall = { index: number; id: string | null; type: string | null;
  name: string; arguments: string; envelopeInvalid: boolean };
export type CandidateBatch = { calls: readonly CandidateCall[]; terminal: string;
  envelopeInvalid: boolean };
export type ValidatedCandidate =
  | { kind: 'valid'; nativeCall: z.infer<typeof nativeToolCallSchema>;
    envelope: ActivateSkillEnvelope | CallToolEnvelope }
  | { kind: 'rejected'; diagnostics: CalendarRepairDiagnostics; rawArgumentsSha256: string }
  | { kind: 'failure'; failure: CalendarFailure };

const paths = new Set([
  '$', 'tool_calls', 'tool_calls.id', 'tool_calls.name', 'tool_calls.arguments',
  'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId', 'summary', 'start', 'end',
  'timeZone', 'description', 'location',
  'calendarId', 'calendarIds', 'plugin', 'tool', 'tools', 'arguments',
]);

export function normalizeDiagnostics(input: CalendarRepairDiagnostics, limits: CalendarLimits): CalendarRepairDiagnostics {
  const out: CalendarRepairDiagnostics = [];
  for (const entry of input) {
    const safe = { ...entry, path: paths.has(entry.path) ? entry.path : '$' } as CalendarRepairDiagnostics[number];
    if (out.some(v => JSON.stringify(v) === JSON.stringify(safe))) continue;
    if (out.length >= limits.diagnosticCount || JSON.stringify([...out, safe]).length > limits.diagnosticChars) break;
    out.push(safe);
  }
  const bounded = out.length ? out : [{ path: '$', code: 'invalid-envelope', expected: 'native-envelope' }] as CalendarRepairDiagnostics;
  if (JSON.stringify(bounded).length > limits.diagnosticChars) throw new Error('Diagnostic budget exhausted.');
  return repairDiagnosticsSchema.parse(bounded);
}

function failure(category: CalendarFailure['category'], code: string, retry: CalendarFailure['retry'] = 'none'): ValidatedCandidate {
  return { kind: 'failure', failure: calendarFailureSchema.parse({ category, code, retry }) };
}

function argumentHash(batch: CandidateBatch): string {
  return createHash('sha256').update(JSON.stringify(batch.calls.map(c => [c.index, c.arguments]))).digest('hex');
}

function rejected(input: CalendarRepairDiagnostics, batch: CandidateBatch, limits: CalendarLimits): ValidatedCandidate {
  try {
    return { kind: 'rejected', diagnostics: normalizeDiagnostics(input, limits), rawArgumentsSha256: argumentHash(batch) };
  } catch (error) {
    if (error instanceof Error && error.message === 'Diagnostic budget exhausted.') {
      return failure('budget', 'DIAGNOSTIC_BUDGET_EXCEEDED');
    }
    throw error;
  }
}

function expectedType(_name: string, field: string): CalendarRepairDiagnostics[number]['expected'] {
  if (field === 'arguments') return 'object';
  if (field === 'tools') return 'bounded-value';
  if (field === 'plugin' || field === 'tool') return 'string';
  return 'bounded-value';
}

function diagnosticPath(value: unknown): CalendarRepairDiagnostics[number]['path'] {
  return typeof value === 'string' && paths.has(value) ? value as CalendarRepairDiagnostics[number]['path'] : '$';
}

function jsonType(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function observeRejection(diagnostic: DiagnosticSink | undefined, fields: Readonly<Record<string, unknown>>): void {
  diagnose(diagnostic, {
    stage: 'validation', state: 'rejected', origin: 'local', delivery: 'not-sent', ...fields,
  });
}

function observeIssues(call: CandidateCall, parsed: unknown, issues: readonly ZodIssue[],
  limits: CalendarLimits, diagnostic: DiagnosticSink | undefined): void {
  const root = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null;
  for (const issue of issues.slice(0, Math.min(limits.diagnosticCount, 10))) {
    const path = issue.path;
    const field = issue.code === 'unrecognized_keys' ? '$' : diagnosticPath(path[0]);
    let value = field === '$' ? parsed : root?.[field];
    const index = path[1];
    const member = field === 'calendarIds' && typeof index === 'number'
      && Number.isInteger(index) && index >= 0 && index < 100;
    if (member && Array.isArray(value)) value = value[index];
    const missing = issue.code === 'invalid_type' && issue.received === 'undefined';
    diagnose(diagnostic, {
      stage: 'validation', state: 'rejected', origin: 'local', delivery: 'not-sent',
      tool: call.name, toolCallId: call.id, field,
      reason: issue.code === 'unrecognized_keys' ? 'unknown-field' : missing ? 'missing'
        : issue.code === 'too_small' || issue.code === 'too_big' ? 'out-of-range'
        : issue.code === 'custom' ? 'invalid-value' : 'wrong-type',
      expected: member ? 'string' : field === 'calendarIds' ? 'array'
        : field === '$' ? 'object' : expectedType(call.name, field),
      constraint: issue.code === 'unrecognized_keys' ? 'no-extra-fields' : missing ? 'required'
        : issue.code === 'too_small' ? 'min' : issue.code === 'too_big' ? 'max'
        : field === 'calendarIds' && issue.code === 'custom' ? 'unique' : 'type',
      suppliedType: jsonType(value), presence: value === undefined ? 'missing' : 'present',
      limit: issue.code === 'too_small' ? issue.minimum : issue.code === 'too_big' ? issue.maximum : undefined,
    });
  }
}

function fromZod(name: string, issues: readonly { code: string; path: (string | number)[]; received?: unknown }[]): CalendarRepairDiagnostics {
  const entries: CalendarRepairDiagnostics[number][] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      entries.push({ path: '$', code: 'unknown-field', expected: 'object' });
      continue;
    }
    const path = diagnosticPath(issue.path[0]);
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : '';
    if (issue.code === 'custom') {
      entries.push({ path, code: 'invalid-value', expected: 'bounded-value' });
      continue;
    }
    if (field === 'calendarIds') {
      entries.push({ path, code: 'wrong-type', expected: 'bounded-value' });
      continue;
    }
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      entries.push({ path, code: 'missing', expected: expectedType(name, field) });
      continue;
    }
    if (issue.code === 'invalid_type') {
      entries.push({ path, code: 'wrong-type', expected: expectedType(name, field) });
      continue;
    }
    if (issue.code === 'too_small' || issue.code === 'too_big') {
      entries.push({ path, code: 'wrong-type', expected: 'bounded-value' });
      continue;
    }
    entries.push({ path, code: 'wrong-type', expected: 'bounded-value' });
  }
  return (entries.length ? entries : [{ path: '$', code: 'invalid-envelope', expected: 'native-envelope' }]) as CalendarRepairDiagnostics;
}

function incompleteName(name: string, allowedNames: ReadonlySet<string>, terminal: string): boolean {
  return terminal === 'length' && name.length > 0 && [...allowedNames].some(allowed => allowed.startsWith(name) && allowed !== name);
}

export function validateCalendarCandidate(batch: CandidateBatch,
  allowed: readonly SkillNativeDefinition[], limits: CalendarLimits,
  diagnostic?: DiagnosticSink): ValidatedCandidate {
  const allowedNames = new Set<string>(allowed.map(tool => tool.name));
  const scans = batch.calls.map(call => scanJsonObject(call.arguments, limits));
  const first = batch.calls[0];
  const scoped = (fields: Readonly<Record<string, unknown>>): void => observeRejection(diagnostic, {
    tool: first?.name, toolCallId: first?.id ?? undefined, ...fields,
  });
  if (batch.calls.some(call => call.name.length > 0 && !allowedNames.has(call.name) && !incompleteName(call.name, allowedNames, batch.terminal))) {
    scoped({ reason: 'unclassified', code: 'UNKNOWN_OR_DISABLED_TOOL', field: '$',
      suppliedType: 'unavailable', presence: 'unavailable' });
    return failure('policy', 'UNKNOWN_OR_DISABLED_TOOL');
  }
  if (scans.some(scan => scan.forbidden)) {
    scoped({ reason: 'unclassified', code: 'FORBIDDEN_TOOL_FIELD', field: '$',
      suppliedType: 'unavailable', presence: 'unavailable' });
    return failure('policy', 'FORBIDDEN_TOOL_FIELD');
  }
  if (scans.some(scan => scan.code === 'byte-limit')) {
    scoped({ reason: 'budget-exhausted', code: 'ARGUMENT_BUDGET_EXCEEDED', field: '$',
      suppliedType: 'unavailable', presence: 'unavailable' });
    return failure('budget', 'ARGUMENT_BUDGET_EXCEEDED');
  }
  if (batch.calls.length !== 1 || batch.calls[0]!.index !== 0) {
    scoped({ reason: 'cardinality', field: 'tool_calls', expected: 'one-call', constraint: 'one-call',
      suppliedType: 'unavailable', presence: 'unavailable' });
    return rejected([{ path: 'tool_calls', code: 'cardinality', expected: 'one-call' }], batch, limits);
  }
  const call = batch.calls[0]!;
  const scan = scans[0]!;
  const scanFacts = (reason: string, expected: string, constraint: string): void => observeRejection(diagnostic, {
    tool: call.name, toolCallId: call.id ?? undefined, reason, field: '$', expected, constraint,
    suppliedType: 'unavailable', presence: 'unavailable',
  });
  if (batch.envelopeInvalid || call.envelopeInvalid || call.id === null || !idSchema.safeParse(call.id).success
    || call.type !== 'function' || call.name.length === 0) {
    scanFacts('invalid-envelope', 'native-envelope', 'native-envelope');
    return rejected([{ path: '$', code: 'invalid-envelope', expected: 'native-envelope' }], batch, limits);
  }
  if (batch.terminal === 'length') {
    scanFacts('truncated', 'complete-json', 'json');
    return rejected([{ path: '$', code: 'truncated', expected: 'complete-json' }], batch, limits);
  }
  if (batch.terminal !== 'tool_calls') {
    scanFacts('invalid-envelope', 'native-envelope', 'native-envelope');
    return rejected([{ path: '$', code: 'invalid-envelope', expected: 'native-envelope' }], batch, limits);
  }
  if (scan.code === 'duplicate-key') {
    scanFacts('duplicate-key', 'complete-json', 'json');
    return rejected([{ path: '$', code: 'duplicate-key', expected: 'complete-json' }], batch, limits);
  }
  if (scan.code === 'malformed-json') {
    scanFacts('malformed-json', 'complete-json', 'json');
    return rejected([{ path: '$', code: 'malformed-json', expected: 'complete-json' }], batch, limits);
  }
  if (scan.code === 'depth-limit') {
    scanFacts('depth-limit', 'complete-json', 'json');
    return rejected([{ path: '$', code: 'depth-limit', expected: 'bounded-value' }], batch, limits);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(call.arguments) as unknown; }
  catch {
    scanFacts('malformed-json', 'complete-json', 'json');
    return rejected([{ path: '$', code: 'malformed-json', expected: 'complete-json' }], batch, limits);
  }
  const schema = call.name === 'activate_skill' ? activateSkillEnvelopeSchema : callToolEnvelopeSchema;
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    observeIssues(call, parsed, validated.error.issues, limits, diagnostic);
    return rejected(fromZod(call.name, validated.error.issues), batch, limits);
  }
  return { kind: 'valid', nativeCall: nativeToolCallSchema.parse({
    id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
  }), envelope: validated.data };
}
