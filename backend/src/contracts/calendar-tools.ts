/**
 * ============================================================================
 * FILE: calendar-tools.ts
 * LOCATION: backend/src/contracts/calendar-tools.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar tool schemas, input/result contracts, and MCP definitions.
 *
 * ROLE IN PROJECT:
 *    Authoritative catalogue for all 5 calendar tools, input validation schemas,
 *    result unions (v1 and v2), forbidden parameter keys, and tool call envelopes.
 *
 * KEY COMPONENTS:
 *    - CALENDAR_TOOLS / CALENDAR_TOOLS_V1: Tool metadata catalogue.
 *    - calendarInputSchemas / calendarInputSchemasV1: Strict input schemas.
 *    - calendarResultSchema / calendarResultV1Schema / calendarResultV2Schema: Result unions.
 *    - calendarCallSchema / calendarCallV1Schema: Tool call unions.
 *    - forbiddenCalendarKeys: Blocklist for server-reserved parameter names.
 * ============================================================================
 */

import { z } from 'zod';
import { CALENDAR_PLUGIN_ID, CALENDAR_TOOL_REVISION, CALENDAR_TOOL_REVISION_V1,
  SKILL_PROTOCOL_VERSION, SKILL_SELECTION_LIMIT } from './calendar-policy.js';
import { calendarIdSchema, calendarListCalendarsResultSchema,
  calendarCanonicalIdSchema } from './calendar-discovery.js';
import { calendarCheckAvailabilityResultSchema } from './calendar-availability.js';
import { idSchema } from './identifiers.js';

export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const text = (max: number, min = 1) => z.string().min(min).max(max);
const timestamp = text(96);
const zone = text(100);

export const calendarInputSchemasV1 = {
  calendar_list_events: z.object({ timeMin: timestamp, timeMax: timestamp,
    maxResults: z.number().int().min(1).max(20), pageToken: text(2048).optional() }).strict(),
  calendar_get_event: z.object({ eventId: text(1024) }).strict(),
  calendar_create_event: z.object({ summary: text(200), start: timestamp, end: timestamp,
    timeZone: zone, description: text(2000, 0).optional(), location: text(500, 0).optional() }).strict(),
} as const;

export const calendarInputSchemas = {
  calendar_list_events: calendarInputSchemasV1.calendar_list_events.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_get_event: calendarInputSchemasV1.calendar_get_event.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_create_event: calendarInputSchemasV1.calendar_create_event.extend({ calendarId: calendarIdSchema.optional() }).strict(),
  calendar_list_calendars: z.object({ pageToken: text(2048).optional() }).strict(),
  calendar_check_availability: z.object({ timeMin: timestamp, timeMax: timestamp, timeZone: zone,
    calendarIds: z.array(calendarIdSchema).min(1).max(100)
      .refine(v => new Set(v).size === v.length).optional() }).strict(),
} as const;
export type CalendarToolName = keyof typeof calendarInputSchemas;
export type CalendarCreateInput = z.infer<typeof calendarInputSchemas.calendar_create_event>;
export const calendarToolNameSchema = z.enum(['calendar_list_events', 'calendar_get_event',
  'calendar_create_event', 'calendar_list_calendars', 'calendar_check_availability']);

export const forbiddenCalendarKeys = ['attendees', 'sendUpdates', 'sendNotifications',
  'recurrence', 'attachments', 'conferenceData', 'reminders', 'visibility', 'transparency',
  'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests', 'anyoneCanAddSelf',
  'organizer', 'creator', 'iCalUID', 'id', 'date', 'userId', 'accountId',
  'connectionId', 'connectionRevision', 'accessToken', 'refreshToken', 'authorization',
  'headers', '_meta', 'endpoint', 'url', 'model', 'modelId', 'allDay', 'eventType',
  'privateCopy', 'extendedProperties', 'endTimeUnspecified', 'apiKey', 'clientSecret',
  'codeVerifier', 'credentialVersion', 'targetRevision', 'confirmed', 'conflictAccepted',
  'proposalId', 'approvalId', 'defaultSettingRevision', 'discoveryRevision',
  'availabilityRevision', 'googleSubjectId', 'proofRevision'] as const;

const stringProperty = (maxLength: number, minLength = 1) => ({
  type: 'string' as const, minLength, maxLength,
});

const definitionsV1 = [
  { name: 'calendar_list_events' as const, description: 'List timed events in an explicit bounded range.',
    required: ['timeMin', 'timeMax', 'maxResults'], properties: {
      timeMin: stringProperty(96), timeMax: stringProperty(96),
      maxResults: { type: 'integer', minimum: 1, maximum: 20 }, pageToken: stringProperty(2048) } },
  { name: 'calendar_get_event' as const, description: 'Read one known event on the configured owned calendar.',
    required: ['eventId'], properties: { eventId: stringProperty(1024) } },
  { name: 'calendar_create_event' as const, description: 'Create one ordinary timed event without invitations.',
    required: ['summary', 'start', 'end', 'timeZone'], properties: { summary: stringProperty(200),
      start: stringProperty(96), end: stringProperty(96), timeZone: stringProperty(100),
      description: stringProperty(2000, 0), location: stringProperty(500, 0) } },
];
export const CALENDAR_TOOLS_V1 = definitionsV1.map(({ name, description, required, properties }) => ({
  name, description, revision: CALENDAR_TOOL_REVISION_V1,
  inputSchema: { type: 'object' as const, additionalProperties: false as const, required, properties },
}));

const definitionsV2 = [
  { name: 'calendar_list_events' as const, description: 'List timed and all-day events on one authorized calendar within a range of up to 31 days. calendarId omission uses default. Copy nextPageToken for pagination.',
    required: ['timeMin', 'timeMax', 'maxResults'], properties: {
      timeMin: stringProperty(96), timeMax: stringProperty(96),
      maxResults: { type: 'integer', minimum: 1, maximum: 20 },
      pageToken: stringProperty(2048),
      calendarId: stringProperty(1024) } },
  { name: 'calendar_get_event' as const, description: 'Read one timed or all-day event using its Google eventId on one authorized calendar. calendarId omission uses default.',
    required: ['eventId'], properties: { eventId: stringProperty(1024),
      calendarId: stringProperty(1024) } },
  { name: 'calendar_create_event' as const, description: 'Create one timed event with summary, offset start/end, and IANA timeZone. calendarId omission uses default.',
    required: ['summary', 'start', 'end', 'timeZone'], properties: { summary: stringProperty(200),
      start: stringProperty(96), end: stringProperty(96),
      timeZone: stringProperty(100), description: stringProperty(2000, 0),
      location: stringProperty(500, 0), calendarId: stringProperty(1024) } },
  { name: 'calendar_list_calendars' as const, description: 'List visible calendars. Copy nextPageToken as pageToken (an Aurvin continuation). owner accessRole reflects manager access, not proof of data ownership.',
    required: [], properties: { pageToken: stringProperty(2048) } },
  { name: 'calendar_check_availability' as const, description: 'Check busy intervals for an offset time range of up to 31 days and IANA timeZone across authorized calendars.',
    required: ['timeMin', 'timeMax', 'timeZone'], properties: { timeMin: stringProperty(96),
      timeMax: stringProperty(96), timeZone: stringProperty(100), calendarIds: {
        type: 'array', minItems: 1, maxItems: 100, uniqueItems: true,
        items: stringProperty(1024) } } },
];
export const CALENDAR_TOOLS = definitionsV2.map(({ name, description, required, properties }) => ({
  name, description, revision: CALENDAR_TOOL_REVISION,
  deliveryRetry: name === 'calendar_create_event' ? 'never' as const : 'bounded-read' as const,
  annotations: { readOnlyHint: name !== 'calendar_create_event', destructiveHint: false,
    idempotentHint: name !== 'calendar_create_event', openWorldHint: true },
  inputSchema: { type: 'object' as const, additionalProperties: false as const, required, properties },
}));

export const calendarEventSchema = z.object({ eventId: text(1024), summary: text(200, 0),
  start: timestamp, end: timestamp, timeZone: zone,
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  htmlLink: text(2048).nullable(), description: text(2000, 0).optional(), location: text(500, 0).optional(),
}).strict();

/** Read-only v2 projection: timed reads stay unchanged; all-day ends are exclusive. */
export const calendarReadEventV2Schema = z.union([
  calendarEventSchema.extend({ allDay: z.literal(false).optional() }).strict(),
  calendarEventSchema.extend({ allDay: z.literal(true), start: z.string().date(), end: z.string().date(),
    timeZone: zone.nullable() }).strict().refine(v => v.end > v.start),
]);

export const calendarResultV1Schema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('calendar_list_events'), events: z.array(calendarEventSchema).max(20),
    nextPageToken: text(2048).nullable(), truncated: z.boolean() }).strict(),
  z.object({ tool: z.literal('calendar_get_event'), event: calendarEventSchema }).strict(),
  z.object({ tool: z.literal('calendar_create_event'), event: calendarEventSchema }).strict(),
]).superRefine((v, ctx) => {
  if (jsonBytes(v) > 16384) ctx.addIssue({ code: 'custom', message: 'Tool result exceeds UTF-8 byte limit.' });
});
export type CalendarResultV1 = z.infer<typeof calendarResultV1Schema>;

export const calendarResultTargetSchema = z.object({ calendarId: calendarCanonicalIdSchema,
  calendarLabel: text(200), discoveryRevision: z.number().int().positive(),
  privateAccess: z.boolean() }).strict();

export const calendarResultV2Schema = z.union([
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_list_events'),
    target: calendarResultTargetSchema, events: z.array(calendarReadEventV2Schema).max(20),
    nextPageToken: text(2048).nullable(), truncated: z.boolean() }).strict(),
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_get_event'),
    target: calendarResultTargetSchema, event: calendarReadEventV2Schema }).strict(),
  z.object({ schemaVersion: z.literal(2), tool: z.literal('calendar_create_event'),
    target: calendarResultTargetSchema, event: calendarEventSchema }).strict(),
  calendarListCalendarsResultSchema, calendarCheckAvailabilityResultSchema,
]).refine(v => jsonBytes(v) <= 16384);
export type CalendarResultV2 = z.infer<typeof calendarResultV2Schema>;

export const calendarResultSchema = z.union([calendarResultV1Schema, calendarResultV2Schema]);
export type CalendarResult = z.infer<typeof calendarResultSchema>;

export const calendarCallV1Schema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('calendar_list_events'), arguments: calendarInputSchemasV1.calendar_list_events }).strict(),
  z.object({ name: z.literal('calendar_get_event'), arguments: calendarInputSchemasV1.calendar_get_event }).strict(),
  z.object({ name: z.literal('calendar_create_event'), arguments: calendarInputSchemasV1.calendar_create_event }).strict(),
]).superRefine((v, ctx) => {
  if (jsonBytes(v.arguments) > 16384) ctx.addIssue({ code: 'custom', message: 'Arguments exceed UTF-8 byte limit.' });
});
export type CalendarCallV1 = z.infer<typeof calendarCallV1Schema>;

export const calendarCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('calendar_list_events'), arguments: calendarInputSchemas.calendar_list_events }).strict(),
  z.object({ name: z.literal('calendar_get_event'), arguments: calendarInputSchemas.calendar_get_event }).strict(),
  z.object({ name: z.literal('calendar_create_event'), arguments: calendarInputSchemas.calendar_create_event }).strict(),
  z.object({ name: z.literal('calendar_list_calendars'), arguments: calendarInputSchemas.calendar_list_calendars }).strict(),
  z.object({ name: z.literal('calendar_check_availability'), arguments: calendarInputSchemas.calendar_check_availability }).strict(),
]).refine(v => jsonBytes(v.arguments) <= 16384);
export type CalendarCall = z.infer<typeof calendarCallSchema>;

export type SkillRegistryTool = {
  name: string; description: string; revision: string;
  inputSchema: Record<string, unknown>;
};

export function compactSkillCatalog(tools: readonly SkillRegistryTool[] = CALENDAR_TOOLS) {
  return { plugin: CALENDAR_PLUGIN_ID, label: 'Calendar', description: 'Scheduling and availability',
    tools: [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map(t => ({ name: t.name, description: t.description.split('. ')[0].slice(0, 240) })) };
}

function freezeNative<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeNative);
    Object.freeze(value);
  }
  return value;
}

export const SKILL_NATIVE_TOOLS = freezeNative([
  { name: 'activate_skill',
    description: 'Load one, several, or all argument schemas from a listed plugin. Batch tools you already need; reuse loaded schemas.',
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['plugin', 'tools'], properties: {
        plugin: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        tools: { anyOf: [{ type: 'string', enum: ['all'] },
          { type: 'array', minItems: 1, maxItems: SKILL_SELECTION_LIMIT, uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' } }] },
      } } },
  { name: 'call_tool',
    description: 'Execute a canonical tool using its loaded argument schema. Loading is not permission; existing action safety still applies.',
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['plugin', 'tool', 'arguments'], properties: {
        plugin: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        tool: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' },
        arguments: { type: 'object', additionalProperties: true },
      } } },
] as const);
export type SkillNativeDefinition = (typeof SKILL_NATIVE_TOOLS)[number];
export const skillNativeNameSchema = z.enum(['activate_skill', 'call_tool']);

export const repairDiagnosticsSchema = z.array(z.object({
  path: z.enum(['$', 'tool_calls', 'tool_calls.id', 'tool_calls.name', 'tool_calls.arguments',
    'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId', 'summary', 'start', 'end',
    'timeZone', 'description', 'location', 'calendarId', 'calendarIds',
    'plugin', 'tool', 'tools', 'arguments']),
  code: z.enum(['missing', 'wrong-type', 'unknown-field', 'malformed-json', 'duplicate-key',
    'invalid-envelope', 'cardinality', 'truncated', 'byte-limit', 'depth-limit', 'invalid-value', 'redundant-call',
    'schema-not-loaded', 'schema-stale']),
  expected: z.enum(['object', 'string', 'integer', 'one-call', 'complete-json', 'bounded-value', 'native-envelope']),
}).strict()).min(1).max(10).refine(v => JSON.stringify(v).length <= 2048);
export type CalendarRepairDiagnostics = z.infer<typeof repairDiagnosticsSchema>;

export const skillIdentifierSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
export const activateSkillEnvelopeSchema = z.object({ plugin: skillIdentifierSchema,
  tools: z.union([z.literal('all'), z.array(skillIdentifierSchema).min(1).max(SKILL_SELECTION_LIMIT)
    .refine(v => new Set(v).size === v.length)]) }).strict().refine(v => jsonBytes(v) <= 16384);
export const callToolEnvelopeSchema = z.object({ plugin: skillIdentifierSchema,
  tool: skillIdentifierSchema, arguments: z.record(z.unknown()) }).strict().refine(v => jsonBytes(v) <= 16384);
export type ActivateSkillEnvelope = z.infer<typeof activateSkillEnvelopeSchema>;
export type CallToolEnvelope = z.infer<typeof callToolEnvelopeSchema>;

export function selectSkillTools(value: unknown, available: readonly SkillRegistryTool[] = CALENDAR_TOOLS):
  { ok: true; tools: SkillRegistryTool[] }
  | { ok: false; code: 'INVALID_SELECTION' | 'UNKNOWN_PLUGIN' | 'UNKNOWN_TOOL' } {
  const parsed = activateSkillEnvelopeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, code: 'INVALID_SELECTION' };
  if (parsed.data.plugin !== CALENDAR_PLUGIN_ID || available.length === 0)
    return { ok: false, code: 'UNKNOWN_PLUGIN' };
  const selection = parsed.data.tools;
  if (selection !== 'all' && selection.some(name => !available.some(t => t.name === name)))
    return { ok: false, code: 'UNKNOWN_TOOL' };
  return { ok: true, tools: available.filter(t => selection === 'all' || selection.includes(t.name))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
}

const skillRevisionSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
const disclosedSkillSchema = z.object({ tool: skillIdentifierSchema, revision: skillRevisionSchema,
  inputSchema: z.record(z.unknown()), instructions: z.string().min(1).max(1000) }).strict();
const loadedSkillReferenceSchema = z.object({ tool: skillIdentifierSchema,
  revision: skillRevisionSchema, disclosureCallId: idSchema }).strict();
export const skillDisclosureSchema = z.object({ kind: z.literal('skill-disclosure'),
  protocolVersion: z.literal(SKILL_PROTOCOL_VERSION), plugin: skillIdentifierSchema,
  disclosures: z.array(disclosedSkillSchema).max(SKILL_SELECTION_LIMIT),
  alreadyLoaded: z.array(loadedSkillReferenceSchema).max(SKILL_SELECTION_LIMIT),
}).strict().refine(v => {
  const names = [...v.disclosures, ...v.alreadyLoaded].map(t => t.tool);
  return names.length > 0 && names.length <= SKILL_SELECTION_LIMIT && new Set(names).size === names.length;
});

const skillErrorRules = {
  SCHEMA_NOT_LOADED: { retry: 'activate-skill', instruction: 'Call activate_skill for this plugin and tool, then retry call_tool using the revealed schema.' },
  SCHEMA_STALE: { retry: 'activate-skill', instruction: 'Call activate_skill for this plugin and tool to load its current revision, then retry call_tool using that schema.' },
  ARGUMENTS_INVALID: { retry: 'correct-arguments', instruction: 'Correct call_tool arguments using the retained schema and validation diagnostics; do not repeat an attempted write.' },
  UNKNOWN_PLUGIN: { retry: 'none', instruction: 'Use a plugin from the enabled compact catalog.' },
  UNKNOWN_TOOL: { retry: 'none', instruction: 'Use a canonical tool name from this plugin catalog.' },
  INVALID_SELECTION: { retry: 'none', instruction: 'Select all or a nonempty bounded list of distinct canonical tool names.' },
  DISCLOSURE_BUDGET_EXCEEDED: { retry: 'none', instruction: 'Request a smaller explicit tool selection. If retained context is full, start a new chat.' },
} as const;
const skillErrorCodeSchema = z.enum(['SCHEMA_NOT_LOADED', 'SCHEMA_STALE', 'ARGUMENTS_INVALID',
  'UNKNOWN_PLUGIN', 'UNKNOWN_TOOL', 'INVALID_SELECTION', 'DISCLOSURE_BUDGET_EXCEEDED']);
export type SkillErrorCode = z.infer<typeof skillErrorCodeSchema>;
export const skillErrorSchema = z.object({ kind: z.literal('skill-error'),
  protocolVersion: z.literal(SKILL_PROTOCOL_VERSION), plugin: skillIdentifierSchema,
  tool: skillIdentifierSchema.nullable(), code: skillErrorCodeSchema,
  retry: z.enum(['activate-skill', 'correct-arguments', 'none']),
  instruction: z.string().min(1).max(512), diagnostics: repairDiagnosticsSchema.nullable(),
}).strict().refine(v => v.retry === skillErrorRules[v.code].retry
  && v.instruction === skillErrorRules[v.code].instruction
  && (v.code === 'ARGUMENTS_INVALID' ? v.diagnostics !== null : v.diagnostics === null)
  && (!['SCHEMA_NOT_LOADED', 'SCHEMA_STALE', 'ARGUMENTS_INVALID'].includes(v.code) || v.tool !== null));
export const skillLocalResultSchema = z.union([skillDisclosureSchema, skillErrorSchema])
  .refine(v => jsonBytes(v) <= 16384);
export type SkillLocalResult = z.infer<typeof skillLocalResultSchema>;
export function skillError(code: SkillErrorCode, plugin: string, tool: string | null,
  diagnostics: z.infer<typeof repairDiagnosticsSchema> | null = null) {
  return skillErrorSchema.parse({ kind: 'skill-error', protocolVersion: SKILL_PROTOCOL_VERSION,
    plugin, tool, code, ...skillErrorRules[code], diagnostics });
}
export function serializeSkillLocalResult(value: unknown, resultBytes = 16384): string {
  const result = skillLocalResultSchema.parse(value);
  const content = JSON.stringify(result);
  if (!Number.isSafeInteger(resultBytes) || resultBytes < 1 || resultBytes > 16384
    || Buffer.byteLength(content, 'utf8') > resultBytes) throw new RangeError('Skill result byte limit.');
  return content;
}
