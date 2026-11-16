/**
 * ============================================================================
 * FILE: calendar-context.ts
 * LOCATION: backend/src/context/calendar-context.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assemble and validate Calendar-specific model context and tool result groups.
 *
 * ROLE IN PROJECT:
 *    Ensures tool groups conform to bounded budgets, authenticates source provenance
 *    against the account authority, and rebuilds model messages for a current v2 turn.
 *
 * KEY COMPONENTS:
 *    - assertGroups: Validates tool call/result bounds, duplicates, and source lifetimes.
 *    - assertV2Provenance: Verifies source account revisions and targets against the result.
 *    - calendarContext: Assembles bounded messages and calculates remaining context tokens.
 * ============================================================================
 */

import { z } from 'zod';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import {
  completeToolGroupSchema,
  completeToolGroupV2Schema,
  type CompleteCalendarToolGroup,
  type NativeCalendarModelMessage,
  type SkillDecisionRequest,
} from '../contracts/calendar-model.js';
import type { CalendarLimits } from '../contracts/calendar-policy.js';
import type { AssembledContext } from '../contracts/context.js';
import { CALENDAR_TOMBSTONE } from '../contracts/calendar-sources.js';
import { calendarResultV2Schema, compactSkillCatalog, skillLocalResultSchema } from '../contracts/calendar-tools.js';
import { loadedSkillRevisions, type LoadedSkill } from '../chat-runtime/calendar-skills.js';
import { estimateCalendarInput } from '../model/calendar-policy.js';
import { rebuildCalendarMessages } from '../model/calendar-repair.js';
import { AppError } from '../platform/errors/app-error.js';
import type { PositionedContext } from './referenced-context-assembler.js';

const UNAVAILABLE_HISTORY = JSON.stringify({
  kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE,
});
const HISTORY_WITHHELD_NOTE = 'Earlier Google Calendar tool payloads are not in this prompt. '
  + 'The chat transcript is what the user saw. Do not recant those replies or claim those '
  + 'lookups failed or that their details were invented. For new calendar facts, call tools again.';

export type CompatibleCalendarToolGroup = CompleteCalendarToolGroup | z.infer<typeof completeToolGroupV2Schema>;

const compatibleToolGroupSchema = z.union([completeToolGroupSchema, completeToolGroupV2Schema]);

export type CalendarContextInput = {
  context: AssembledContext;
  acceptedInput: string;
  groups: readonly CompatibleCalendarToolGroup[];
  historicalGroups?: ReadonlyMap<string, readonly CompatibleCalendarToolGroup[]>;
  repair: SkillDecisionRequest['repair'];
  tools: SkillDecisionRequest['tools'];
  budgets: BudgetConfig;
  limits: CalendarLimits;
  binding: CalendarAccountBinding;
  /**
   * 'current' assembles a new execution and accepts v2 groups only.
   * 'historical' is the explicit read-only compatibility path for v1 evidence.
   */
  compatibility?: 'current' | 'historical';
  volatileSourceIds?: ReadonlySet<string>;
  now: number;
  /** Hidden model-only note; never a visible transcript line. */
  note?: string | null;
};

export type CalendarContextOutput = {
  messages: NativeCalendarModelMessage[];
  estimatedInputTokens: number;
  remainingContextTokens: number;
  loadedSkills: ReadonlyMap<string, LoadedSkill>;
};

function incomplete(): never {
  throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.');
}

function isV2Group(value: CompatibleCalendarToolGroup): value is z.infer<typeof completeToolGroupV2Schema> {
  return value.sources.every(source => source.schemaVersion === 2);
}

/**
 * Verifies that every source covers this tool call and that the result it produced is
 * the result the source was taken for. Volatile sources deliberately withhold labels
 * and are checked only for the call they belong to.
 */
function assertV2Provenance(group: z.infer<typeof completeToolGroupV2Schema>): void {
  const callId = group.assistant.tool_calls[0].id;
  let content: unknown;
  try { content = JSON.parse(group.result.content); } catch { incomplete(); }
  const parsed = calendarResultV2Schema.safeParse(content);
  if (!parsed.success) incomplete();
  const result = parsed.data;
  for (const source of group.sources) {
    if (!source.toolCallIds.includes(callId)) incomplete();
    if (source.permission.content !== 'retained') continue;
    const targets = 'target' in result ? [result.target]
      : result.tool === 'calendar_list_calendars'
        ? result.calendars.map(calendar => ({ calendarId: calendar.calendarId, calendarLabel: calendar.label }))
        : result.calendars;
    if (!targets.every(target => source.targets.some(known => known.calendarId === target.calendarId
      && known.calendarLabel === target.calendarLabel))) incomplete();
    if (result.tool === 'calendar_check_availability'
      && (source.calendarSetHash !== result.calendarSetHash
        || source.availabilityRevision !== result.availabilityRevision
        || source.discoveryRevision !== result.discoveryRevision)) incomplete();
  }
}

function contextLimit(): never {
  throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat has reached its context limit. Start a new chat.', false);
}

function assertGroups(input: CalendarContextInput): {
  groups: CompatibleCalendarToolGroup[];
  historicalGroups: { turnId: string; groups: CompatibleCalendarToolGroup[] }[];
} {
  if (input.groups.length > input.limits.modelDispatches) contextLimit();
  const historical = input.compatibility === 'historical';
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  const volatile = input.volatileSourceIds ?? new Set<string>();
  const validate = (candidates: readonly CompatibleCalendarToolGroup[]): CompatibleCalendarToolGroup[] => {
    const parsed: CompatibleCalendarToolGroup[] = [];
    for (const group of candidates) {
      const value = compatibleToolGroupSchema.parse(group);
      const call = value.assistant.tool_calls[0];
      if (ids.has(call.id)) incomplete();
      ids.add(call.id);
      if (Buffer.byteLength(call.function.arguments, 'utf8') > input.limits.argumentBytes
        || Buffer.byteLength(value.result.content, 'utf8') > input.limits.resultBytes) contextLimit();
      // An explicitly unavailable historical pair is not a validated API success or schema authority.
      if (value.result.content === UNAVAILABLE_HISTORY) {
        if (!historical || value.sources.length !== 0) incomplete();
        parsed.push(value);
        continue;
      }
      for (const source of value.sources) {
        if (sourceIds.has(source.sourceId)) incomplete();
        sourceIds.add(source.sourceId);
        if (source.connectionId !== input.binding.connectionId
          || source.connectionRevision !== input.binding.connectionRevision) {
          incomplete();
        }
        if (source.permission.content === 'volatile') {
          if (!volatile.has(source.sourceId)) incomplete();
        } else if (source.redactedAt !== null || Date.parse(source.expiresAt) <= input.now) {
          incomplete();
        }
      }
      const local = value.result.name === 'activate_skill'
        || (value.result.name === 'call_tool' && value.sources.length === 0);
      if (local) {
        if (value.sources.length !== 0) incomplete();
        let content: unknown;
        try { content = JSON.parse(value.result.content); } catch { incomplete(); }
        const result = skillLocalResultSchema.safeParse(content);
        if (!result.success) incomplete();
        if (value.result.name === 'activate_skill' && result.data.kind === 'skill-disclosure') {
          let envelope: unknown;
          try { envelope = JSON.parse(call.function.arguments); } catch { incomplete(); }
          if (!envelope || typeof envelope !== 'object'
            || (envelope as { plugin?: unknown }).plugin !== result.data.plugin) incomplete();
        }
      } else if (isV2Group(value)) assertV2Provenance(value);
      else if (!historical) incomplete();
      parsed.push(value);
    }
    return parsed;
  };
  const groups = validate(input.groups);
  const historicalGroups: { turnId: string; groups: CompatibleCalendarToolGroup[] }[] = [];
  for (const [turnId, oldGroups] of input.historicalGroups ?? []) {
    if (oldGroups.length > input.limits.modelDispatches) contextLimit();
    historicalGroups.push({ turnId, groups: validate(oldGroups) });
  }
  return { groups, historicalGroups };
}

export function calendarContext(input: CalendarContextInput): CalendarContextOutput {
  const { groups, historicalGroups } = assertGroups(input);
  const last = input.context.messages.at(-1);
  if (!last || last.role !== 'user' || last.content !== input.acceptedInput) {
    throw new AppError('NOT_READY', 'Accepted chat context is unavailable.');
  }
  const positions = (input.context as Partial<PositionedContext>).historyPositions ?? [];
  const insertions = new Map<number, CompatibleCalendarToolGroup[]>();
  let withheldHistory = false;
  for (const { turnId, groups: oldGroups } of historicalGroups) {
    const usable: CompatibleCalendarToolGroup[] = [];
    for (const group of oldGroups) {
      if (group.result.content === UNAVAILABLE_HISTORY) withheldHistory = true;
      else usable.push(group);
    }
    if (usable.length === 0) continue;
    const origin = positions.find(position => position.turnId === turnId && position.role === 'user');
    if (!origin) incomplete();
    const after = positions.find(position => position.index > origin.index
      && (position.turnId !== turnId || position.role === 'assistant'));
    const index = after?.index ?? input.context.messages.length - 1;
    if (insertions.has(index)) incomplete();
    insertions.set(index, usable);
  }
  const catalogIndex = positions[0]?.index ?? input.context.messages.length - 1;
  const catalogMessage: NativeCalendarModelMessage = { role: 'system',
    content: 'Enabled plugin catalog (trusted application metadata):\n' + JSON.stringify(compactSkillCatalog()) };
  const prefix: NativeCalendarModelMessage[] = [];
  for (let index = 0; index < input.context.messages.length - 1; index++) {
    if (index === catalogIndex) prefix.push(catalogMessage);
    for (const group of insertions.get(index) ?? []) prefix.push(group.assistant, group.result);
    prefix.push(input.context.messages[index]!);
  }
  if (catalogIndex === input.context.messages.length - 1) prefix.push(catalogMessage);
  for (const group of insertions.get(input.context.messages.length - 1) ?? []) {
    prefix.push(group.assistant, group.result);
  }
  const note = [input.note, withheldHistory ? HISTORY_WITHHELD_NOTE : null]
    .filter((value): value is string => Boolean(value)).join('\n') || null;
  const messages = rebuildCalendarMessages({
    prefix,
    acceptedInput: { role: 'user', content: input.acceptedInput },
    groups,
  }, input.repair, note);
  const estimatedInputTokens = estimateCalendarInput(messages, input.tools);
  const remainingContextTokens = input.budgets.maxContextTokens
    - input.budgets.maxOutputTokens - input.budgets.modelMarginTokens;
  if (estimatedInputTokens > remainingContextTokens
    || messages.length > input.budgets.maxMessagesInContext) contextLimit();
  return { messages, estimatedInputTokens, remainingContextTokens,
    loadedSkills: loadedSkillRevisions(messages) };
}
