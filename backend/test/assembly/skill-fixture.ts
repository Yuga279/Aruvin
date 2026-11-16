/**
 * ============================================================================
 * FILE: skill-fixture.ts
 * LOCATION: backend/test/assembly/skill-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Observe the real assembled Calendar skill path without replacing it.
 *
 * ROLE IN PROJECT:
 *    Reuses assembledCalendarApp and its real provider/runtime/repositories,
 *    adds an observational fetcher boundary plus plugin-boundary spies, and
 *    drives one complete submitted turn with scripted provider responses.
 *
 * KEY COMPONENTS:
 *    - skillAssembly: Assembled app plus request/boundary capture and turn driver.
 *    - skillWire / loadWire / callWire: Stable native SSE response builders.
 *    - snapshot: Normal-path local admission excluded from external discovery.
 * ============================================================================
 */

import { performance } from 'node:perf_hooks';
import { expect, vi } from 'vitest';
import { CalendarApiTools } from '../../src/plugins/google-calendar/tools.js';
import { GoogleCalendarConnections } from '../../src/plugins/google-calendar/connection.js';
import { CalendarDiscoveryService } from '../../src/plugins/google-calendar/discovery.js';
import { GoogleCalendarOAuthClient } from '../../src/plugins/google-calendar/oauth-client.js';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { assembledCalendarApp, type AssembledCalendarInit } from './calendar-fixture.js';
export { textWire };

export const USER = 'aurvin-dev-user';
export type NativeMessage = {
  role: string; content: string | null; tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
};
export type CapturedBody = {
  messages: NativeMessage[];
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>;
  user: string;
};
export function skillWire(name: 'activate_skill' | 'call_tool', args: unknown, id: string,
  content: string | null = null): string {
  return nativeFrame({ role: 'assistant', content, tool_calls: [{ index: 0, id,
    type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}
export function loadWire(tools: 'all' | string[], id = 'load-selected'): string {
  return skillWire('activate_skill', { plugin: 'google-calendar', tools }, id);
}
export function callWire(tool: string, args: unknown, id = 'execute-selected'): string {
  return skillWire('call_tool', { plugin: 'google-calendar', tool, arguments: args }, id);
}
export async function skillAssembly(init: AssembledCalendarInit = {}) {
  const h = await assembledCalendarApp(init);
  const spies = {
    invoke: vi.spyOn(CalendarApiTools.prototype, 'invoke'),
    resolve: vi.spyOn(GoogleCalendarConnections.prototype, 'resolveTarget'),
    check: vi.spyOn(GoogleCalendarConnections.prototype, 'requireTargetCurrent'),
    token: vi.spyOn(GoogleCalendarConnections.prototype, 'withAccessToken'),
    resource: vi.spyOn(CalendarDiscoveryService.prototype, 'ensureFresh'),
    oauth: vi.spyOn(GoogleCalendarOAuthClient.prototype, 'refresh'),
  };
  const snapshot = () => ({
    invoke: spies.invoke.mock.calls.length,
    resolve: spies.resolve.mock.calls.length,
    check: spies.check.mock.calls.length,
    token: spies.token.mock.calls.length,
    resource: spies.resource.mock.calls.length,
    oauth: spies.oauth.mock.calls.length,
    external: h.fetcher.mock.calls.filter(([url]) => !String(url).includes('/chat/completions')).length,
  });
  const boundaries: ReturnType<typeof snapshot>[] = [];
  const original = h.fetcher.getMockImplementation();
  if (!original) {
    Object.values(spies).forEach(s => s.mockRestore());
    await h.dispose();
    throw new Error('Expected deterministic injected fetch');
  }
  h.fetcher.mockImplementation(async (url, options) => {
    if (String(url).includes('/chat/completions')) boundaries.push(snapshot());
    return original(url, options);
  });
  const bodies = h.cal.modelBodies as unknown as CapturedBody[];
  let serial = 0;
  async function turn(content: string, wires: string[], sessionId: string | null = null) {
    const first = bodies.length;
    h.cal.modelWires.push(...wires);
    const started = performance.now();
    const runtime = h.service.operations.runtime;
    const ids = await runtime.submitTurn({ identity: { userId: USER, openRouterUser: USER,
      source: 'authenticated-session' }, sessionId, content, idempotencyKey: `skill-evidence-${++serial}` });
    const frames: Array<{ event: { type: string } }> = [];
    await runtime.executeTurn({ userId: USER, ...ids, signal: new AbortController().signal,
      emit: async frame => { frames.push(frame); },
      emitCalendar: async frame => { frames.push(frame); } });
    const fixtureTaskMs = performance.now() - started;
    const attempt = await h.cal.p.metadata.getAttempt(USER, ids.sessionId, ids.attemptId);
    expect(h.cal.modelWires, 'Every scripted response must be consumed').toHaveLength(0);
    return { ids, frames, status: attempt?.status, fixtureTaskMs, bodies: bodies.slice(first) };
  }
  return { ...h, bodies, boundaries, spies, snapshot, turn,
    async dispose() {
      try { await h.dispose(); }
      finally { Object.values(spies).forEach(s => s.mockRestore()); }
    },
  };
}
