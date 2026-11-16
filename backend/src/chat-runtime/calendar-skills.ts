/**
 * ============================================================================
 * FILE: calendar-skills.ts
 * LOCATION: backend/src/chat-runtime/calendar-skills.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Derive loaded skill knowledge from assembled native disclosures and resolve
 *    activate_skill/call_tool envelopes without any plugin side effects.
 *
 * ROLE IN PROJECT:
 *    Pure local layer between the stable model protocol and the existing Calendar
 *    executor. It never refreshes OAuth, checks permissions, or persists state.
 *
 * KEY COMPONENTS:
 *    - loadedSkillRevisions: reads original disclosures from assembled messages.
 *    - activateLocalSkill: validates and resolves a bounded selection batch.
 *    - requireLoadedSkill: gates call_tool on a current assembled revision.
 * ============================================================================
 */

import { z } from 'zod';
import {
  CALENDAR_TOOLS,
  activateSkillEnvelopeSchema,
  selectSkillTools,
  serializeSkillLocalResult,
  skillError,
  skillLocalResultSchema,
  type ActivateSkillEnvelope,
  type CallToolEnvelope,
  type SkillLocalResult,
  type SkillRegistryTool,
} from '../contracts/calendar-tools.js';
import { completeToolGroupV2Schema, type NativeCalendarModelMessage, type SkillDecision }
  from '../contracts/calendar-model.js';
import { AppError } from '../platform/errors/app-error.js';
import { assertNativeHistory } from '../model/calendar-repair.js';

export type LoadedSkill = { revision: string; disclosureCallId: string };
export type LoadedSkills = ReadonlyMap<string, LoadedSkill>;

export function loadedSkillRevisions(messages: readonly NativeCalendarModelMessage[]): Map<string, LoadedSkill> {
  assertNativeHistory(messages);
  const loaded = new Map<string, LoadedSkill>();
  for (let i = 0; i < messages.length - 1; i++) {
    const assistant = messages[i]!;
    if (!('tool_calls' in assistant)) continue;
    const call = assistant.tool_calls[0];
    const result = messages[i + 1]!;
    if (call.function.name !== 'activate_skill' || result.role !== 'tool'
      || result.name !== 'activate_skill' || result.tool_call_id !== call.id) continue;
    let value: unknown;
    try { value = JSON.parse(result.content); } catch { continue; }
    const parsed = skillLocalResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== 'skill-disclosure') continue;
    const envelope = activateSkillEnvelopeSchema.parse(JSON.parse(call.function.arguments));
    if (envelope.plugin !== parsed.data.plugin) throw new AppError('INVALID_REQUEST', 'Skill history is incomplete.');
    for (const disclosure of parsed.data.disclosures) {
      if (envelope.tools !== 'all' && !envelope.tools.includes(disclosure.tool))
        throw new AppError('INVALID_REQUEST', 'Skill history is incomplete.');
      loaded.set(`${parsed.data.plugin}:${disclosure.tool}`, {
        revision: disclosure.revision, disclosureCallId: call.id,
      });
    }
  }
  return loaded;
}

export function activateLocalSkill(envelope: ActivateSkillEnvelope, loaded: LoadedSkills,
  resultBytes: number, available: readonly SkillRegistryTool[] = CALENDAR_TOOLS): SkillLocalResult {
  const selected = selectSkillTools(envelope, available);
  if (!selected.ok) return skillError(selected.code, envelope.plugin, null);
  const disclosures: Extract<SkillLocalResult, { kind: 'skill-disclosure' }>['disclosures'] = [];
  const alreadyLoaded: Extract<SkillLocalResult, { kind: 'skill-disclosure' }>['alreadyLoaded'] = [];
  for (const tool of selected.tools) {
    const prior = loaded.get(`${envelope.plugin}:${tool.name}`);
    if (prior?.revision === tool.revision) alreadyLoaded.push({ tool: tool.name, ...prior });
    else disclosures.push({ tool: tool.name, revision: tool.revision,
      inputSchema: tool.inputSchema, instructions: tool.description });
  }
  const result: SkillLocalResult = { kind: 'skill-disclosure', protocolVersion: 'plugin-skills.v1',
    plugin: envelope.plugin, disclosures, alreadyLoaded };
  try { serializeSkillLocalResult(result, resultBytes); }
  catch { return skillError('DISCLOSURE_BUDGET_EXCEEDED', envelope.plugin, null); }
  return result;
}

export function skillGroup(decision: Exclude<SkillDecision, { kind: 'text' }>,
  content: string, sources: z.infer<typeof completeToolGroupV2Schema>['sources'] = []) {
  return completeToolGroupV2Schema.parse({
    assistant: { role: 'assistant', content: decision.assistantContent, tool_calls: [decision.nativeCall] },
    result: { role: 'tool', name: decision.nativeCall.function.name,
      tool_call_id: decision.nativeCall.id, content }, sources,
  });
}

export function requireLoadedSkill(envelope: CallToolEnvelope, loaded: LoadedSkills): SkillLocalResult | null {
  if (envelope.plugin !== 'google-calendar') return skillError('UNKNOWN_PLUGIN', envelope.plugin, envelope.tool);
  const tool = CALENDAR_TOOLS.find(candidate => candidate.name === envelope.tool);
  if (!tool) return skillError('UNKNOWN_TOOL', envelope.plugin, envelope.tool);
  const prior = loaded.get(`${envelope.plugin}:${envelope.tool}`);
  return !prior ? skillError('SCHEMA_NOT_LOADED', envelope.plugin, envelope.tool)
    : prior.revision !== tool.revision ? skillError('SCHEMA_STALE', envelope.plugin, envelope.tool) : null;
}
