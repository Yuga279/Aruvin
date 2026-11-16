/**
 * ============================================================================
 * FILE: tool-protocol.fixture.ts
 * LOCATION: backend/test/context/tool-protocol.fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Reconstruct protocol-valid parallel tool groups from P1 causal metadata.
 *
 * ROLE IN PROJECT:
 *    Test-only helper for future AC07 evidence. Not registered or exported from
 *    production context modules and never fetches external result payloads.
 *
 * KEY COMPONENTS:
 *    - reconstructProtocolFixture: One complete originating assistant group.
 *    - ProtocolMessage: Fixture assistant tool_calls plus matching tool results.
 * ============================================================================
 */

import { reconstructToolGroups, toolRequestRecordSchema, toolResultRecordSchema,
  type ToolRequestRecord, type ToolResultRecord } from '../../src/contracts/metadata.js';

type ProtocolMessage =
  | { role: 'assistant'; content: ''; tool_calls: { id: string; type: 'function';
      function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function reconstructProtocolFixture(
  rawRequests: readonly ToolRequestRecord[], rawResults: readonly ToolResultRecord[],
): ProtocolMessage[] {
  try {
    const requests = rawRequests.map((value) => toolRequestRecordSchema.parse(value))
      .sort((a, b) => a.sequence - b.sequence);
    const results = rawResults.map((value) => toolResultRecordSchema.parse(value));
    if (!requests.length || results.length !== requests.length) throw new Error();
    const first = requests[0];
    const sameGroup = requests.every((request) => request.userId === first.userId &&
      request.sessionId === first.sessionId && request.turnId === first.turnId &&
      request.attemptId === first.attemptId && request.originatingAssistantEventId === first.originatingAssistantEventId);
    if (!sameGroup || new Set(requests.map((value) => value.toolCallId)).size !== requests.length ||
      new Set([...requests, ...results].map((value) => value.eventId)).size !== requests.length + results.length ||
      new Set([...requests, ...results].map((value) => value.sequence)).size !== requests.length + results.length) throw new Error();
    for (const request of requests) {
      const args: unknown = JSON.parse(request.argumentsJson);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error();
    }
    if (results.some((result) => result.sequence <= requests.at(-1)!.sequence)) throw new Error();
    const groups = reconstructToolGroups(requests, results);
    const output: ProtocolMessage[] = [{ role: 'assistant', content: '', tool_calls:
      requests.map((request) => ({ id: request.toolCallId, type: 'function',
        function: { name: request.toolName, arguments: request.argumentsJson } })) }];
    for (const request of requests) {
      const result = groups.get(request.toolCallId)?.result;
      if (!result || result.resultRef.storage !== 'inline') throw new Error();
      JSON.parse(result.resultRef.json);
      output.push({ role: 'tool', tool_call_id: request.toolCallId, content: result.resultRef.json });
    }
    return output;
  } catch {
    throw new Error('invalid_tool_fixture');
  }
}
