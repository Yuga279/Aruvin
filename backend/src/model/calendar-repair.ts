/**
 * ============================================================================
 * FILE: calendar-repair.ts
 * LOCATION: backend/src/model/calendar-repair.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Instruction generation and native message reconstruction for calendar tool repairs.
 *
 * ROLE IN PROJECT:
 *    Constructs repair system prompts from validation diagnostics, preserves completed
 *    native assistant/tool pairs across turns, and validates historical call structure.
 *
 * KEY COMPONENTS:
 *    - repairInstruction: Generates structured instructions from bounded diagnostics.
 *    - assertNativeHistory: Validates native message sequence and tool-call pairs.
 *    - rebuildCalendarMessages: Reconstructs native history boundary for model decisions.
 * ============================================================================
 */

import { z } from 'zod';
import { completeToolGroupSchema, completeToolGroupV2Schema, nativeModelMessageSchema, repairDiagnosticsSchema,
  type CalendarDecisionRequest, type CalendarRepairDiagnostics,
  type CompleteCalendarToolGroup, type NativeCalendarModelMessage } from '../contracts/calendar-model.js';
import { activateSkillEnvelopeSchema, callToolEnvelopeSchema, skillNativeNameSchema } from '../contracts/calendar-tools.js';
import { CALENDAR_LIMITS } from '../contracts/calendar-policy.js';
import { scanJsonObject } from './strict-json.js';

export function repairInstruction(input: CalendarRepairDiagnostics): string {
  const diagnostics = JSON.stringify(repairDiagnosticsSchema.parse(input));
  const needsSchema = input.some(item => item.code === 'schema-not-loaded' || item.code === 'schema-stale');
  const effect = needsSchema
    ? 'This rejected call was not executed. Call activate_skill for the identified plugin and tool, then retry call_tool using the revealed schema.'
    : input.some(item => item.code === 'redundant-call')
    ? 'This rejected call was not executed. Its earlier successful result is already present; use that result instead of repeating it.'
    : input.some(item => item.code === 'cardinality')
    ? 'You emitted more than one tool call. Emit exactly one native tool call, then wait. List events for one calendar per decision; after that result you may call again for another calendar.'
    : 'This rejected decision performed no calendar write.';
  return `Correct the previous invalid tool decision using the advertised tools. Validation errors: ${diagnostics}. Use only the native tool-call format. For call_tool, validate arguments against the retained disclosed schema; an advertised wrapper is not the plugin argument schema. For pageToken, omit initially or copy the exact nextPageToken from that tool. Do not switch tools or accounts to bypass denials. ${effect}`;
}

export function assertNativeHistory(input: readonly NativeCalendarModelMessage[]): void {
  const ids = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const message = nativeModelMessageSchema.parse(input[i]);
    if (message.role === 'tool') throw new Error('Unmatched native result.');
    if ('tool_calls' in message) {
      const result = input[++i];
      const parsed = completeToolGroupV2Schema.safeParse({ assistant: message, result, sources: [] });
      const group = parsed.success ? parsed.data : completeToolGroupSchema.parse({ assistant: message, result, sources: [] });
      const id = group.assistant.tool_calls[0].id;
      if (ids.has(id)) throw new Error('Duplicate native call identity.');
      const call = group.assistant.tool_calls[0];
      const scan = scanJsonObject(call.function.arguments, CALENDAR_LIMITS);
      if (scan.code || scan.forbidden) throw new Error('Invalid native history call.');
      const args: unknown = JSON.parse(call.function.arguments);
      if (skillNativeNameSchema.safeParse(call.function.name).success) {
        const schema = call.function.name === 'activate_skill' ? activateSkillEnvelopeSchema : callToolEnvelopeSchema;
        schema.parse(args);
      }
      ids.add(id);
    }
  }
}

export type CompleteCalendarToolGroupV2 = z.infer<typeof completeToolGroupV2Schema>;
export type CalendarHistoryBoundary = {
  prefix: readonly NativeCalendarModelMessage[];
  acceptedInput: { role: 'user'; content: string };
  groups: readonly (CompleteCalendarToolGroup | CompleteCalendarToolGroupV2)[];
};
export function rebuildCalendarMessages(boundary: CalendarHistoryBoundary,
  repair: CalendarDecisionRequest['repair'], note?: string | null): NativeCalendarModelMessage[] {
  const messages: NativeCalendarModelMessage[] = boundary.prefix.map(m => nativeModelMessageSchema.parse(m));
  assertNativeHistory(messages);
  if (boundary.acceptedInput.role !== 'user') throw new Error('Accepted input must be user text.');
  messages.push(nativeModelMessageSchema.parse(boundary.acceptedInput));
  for (const input of boundary.groups) {
    const parsed = completeToolGroupV2Schema.safeParse(input);
    const group = parsed.success ? parsed.data : completeToolGroupSchema.parse(input);
    messages.push(group.assistant, group.result);
  }
  if (repair) messages.push({ role: 'system', content: repairInstruction(repair.diagnostics) });
  if (note) messages.push({ role: 'system', content: note.slice(0, 4000) });
  assertNativeHistory(messages);
  return messages;
}
