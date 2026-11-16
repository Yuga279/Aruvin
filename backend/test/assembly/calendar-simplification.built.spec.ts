/**
 * ============================================================================
 * FILE: calendar-simplification.built.spec.ts
 * LOCATION: backend/test/assembly/calendar-simplification.built.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Run the built AppService/runtime Calendar assembly on offline fixtures.
 *
 * ROLE IN PROJECT:
 *    Proves emitted JavaScript uses CalendarApiTools, truthful native contracts
 *    and P1 dispatch kinds. Not a live-service or native-database result.
 *
 * KEY COMPONENTS:
 *    - compiled AppService and DurableChatRuntime
 *    - real checkout assets and direct executor instance
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { SKILL_NATIVE_TOOLS } from '../../src/contracts/calendar-tools.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { callWire, loadWire } from './skill-fixture.js';

it('runs the built direct assembly with native initial repair continuation contracts and real assets', async () => {
  const { CalendarApiTools } = await import('../../dist/plugins/google-calendar/tools.js');
  const { SKILL_NATIVE_TOOLS: compiledTools } = await import('../../dist/contracts/calendar-tools.js');
  expect(compiledTools).toEqual(SKILL_NATIVE_TOOLS);
  const lines: string[] = [];
  const h = await assembledCalendarApp({ compiled: true, realAssets: true, writeLog: line => { lines.push(line); } });
  try {
    const dependencies = vi.mocked(h.f.ports.runtime).mock.calls.at(-1)![0];
    expect(dependencies.calendar!.execution).toBeInstanceOf(CalendarApiTools);
    h.cal.modelWires.push(loadWire(['calendar_list_calendars'], 'built-load'),
      callWire('calendar_list_calendars', { pageToken: 'first' }, 'built-bad-cursor'),
      callWire('calendar_list_calendars', {}, 'built-corrected'),
      textWire('Your primary calendar is identified; manager access alone does not prove secondary data ownership.'));
    const runtime = h.service.operations.runtime;
    const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
      openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' }, sessionId: null,
      content: 'What calendars do I own?', idempotencyKey: 'calendar-built-0001' });
    await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {} });
    expect(h.cal.modelBodies).toHaveLength(4);
    const native = compiledTools.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.inputSchema,
    } }));
    for (const body of h.cal.modelBodies) {
      expect(body.tools).toEqual(native);
      expect(body.user).toBe('aurvin-dev-user');
    }
    expect(h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com')).toHaveLength(0);
    const records = lines.map(line => JSON.parse(line));
    expect(records.filter(record => record.stage === 'model-dispatch').map(record => record.dispatchKind))
      .toEqual(['initial', 'continuation', 'schema-repair', 'continuation']);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'cursor', reason: 'cursor-format', delivery: 'not-sent' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
    const stored = await h.cal.p.messages.list('aurvin-dev-user', ids.sessionId, { cursor: null, limit: 20 });
    expect(stored.items.filter(message => message.role === 'user')).toHaveLength(1);
    expect(stored.items.filter(message => message.role === 'assistant')).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);
