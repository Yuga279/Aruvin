/**
 * ============================================================================
 * FILE: tools-boundaries.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/tools-boundaries.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Direct-executor lifecycle, drain, cancellation, and post-dispatch safety.
 *
 * ROLE IN PROJECT:
 *    Relocates necessary MCP wrapper guarantees onto CalendarApiTools: active
 *    work accounting, idempotent close, blocked-request abort, and uncertain
 *    create outcomes after a dispatched write.
 *
 * KEY COMPONENTS:
 *    - Active execution accounting until settlement
 *    - Close/cancel/deadline drain without claiming a missing create
 *    - Revocation and admission races before Google effects
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_LIMITS } from '../../../src/contracts/calendar-policy.js';
import { multiToolsFixture } from './tools-multi-fixtures.js';
import { googleJson, googleEvent } from './tools-fixtures.js';

it('counts active direct work until settlement and refuses later work after close', async () => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: async () => { started(); await resume; return googleJson(googleEvent()); },
  }] });
  const pending = f.tools.invoke(f.input);
  try {
    await entered;
    expect(f.tools.activeExecutions).toBe(1);
    const closing = f.tools.close();
    release();
    await pending;
    await closing;
    expect(f.tools.activeExecutions).toBe(0);
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(1);
    await f.tools.close();
  } finally { release(); await pending; await f.tools.close(); }
});

it('never claims a noncreation when a dispatched create is cut short', async () => {
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const f = multiToolsFixture({ steps: [{
    method: 'POST', path: '/calendar/v3/calendars/shared/events',
    response: () => {
      started();
      return new Response(new ReadableStream<Uint8Array>({ pull() { /* never ends */ } }),
        { headers: { 'content-type': 'application/json' } });
    },
  }] });
  const pending = f.tools.invoke(f.input);
  try {
    await entered;
    expect(f.tools.activeExecutions).toBe(1);
    const closing = f.tools.close();
    expect(await pending).toMatchObject({ outcome: 'failure', failure: {
      category: 'uncertain', code: 'WRITE_OUTCOME_UNKNOWN', retry: 'readback' } });
    await closing;
    expect(f.requests).toHaveLength(1);
  } finally { await pending; await f.tools.close(); }
});

it('honours invocation cancellation without an external effect after close', async () => {
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: () => {
      started();
      return new Response(new ReadableStream<Uint8Array>({ pull() { /* never ends */ } }),
        { headers: { 'content-type': 'application/json' } });
    },
  }] });
  const controller = new AbortController();
  const pending = f.tools.invoke({ ...f.input, signal: controller.signal });
  try {
    await entered;
    expect(f.tools.activeExecutions).toBe(1);
    controller.abort();
    expect(await pending).toMatchObject({ outcome: 'failure' });
    expect(f.tools.activeExecutions).toBe(0);
  } finally { await pending; await f.tools.close(); }
});

it('bounds the invocation by a shorter remaining deadline', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: () => new Response(new ReadableStream<Uint8Array>({ pull() { /* never ends */ } }),
      { headers: { 'content-type': 'application/json' } }),
  }] });
  f.input.binding = { ...f.input.binding, deadlineAt: new Date(Date.now() + 200).toISOString() };
  const started = Date.now();
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure' });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(f.tools.activeExecutions).toBe(0);
  } finally { await f.tools.close(); }
});

it('refuses the effect when the connection changes while the credential callback waits', async () => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const opened = new Promise<void>(resolve => { release = resolve; });
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: () => googleJson(googleEvent()),
  }] });
  const original = f.credentials.withAccessToken.bind(f.credentials);
  f.credentials.withAccessToken = async (input, action) => {
    started();
    await opened;
    return original(input, action);
  };
  const pending = f.tools.invoke(f.input);
  try {
    await entered;
    expect(f.tools.activeExecutions).toBe(1);
    f.gate.disable();
    release();
    expect(await pending).toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
    expect(f.requests).toHaveLength(0);
  } finally { release(); await pending; await f.tools.close(); }
});

it('does not accumulate active work across repeated invocations', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [{
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: () => googleJson(googleEvent()),
  }, {
    method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
    response: () => googleJson(googleEvent()),
  }] });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'success' });
    expect(f.tools.activeExecutions).toBe(0);
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'success' });
    expect(f.tools.activeExecutions).toBe(0);
    expect(f.requests).toHaveLength(2);
  } finally { await f.tools.close(); }
});

it('refuses to deliver a result above a lower configured result limit', async () => {
  const f = multiToolsFixture({ operation: null, limits: { ...CALENDAR_LIMITS, resultBytes: 512 },
    call: { name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } },
    steps: [{ method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
      response: () => googleJson(googleEvent()) }] });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      category: 'delivery', code: 'CALENDAR_RESULT_TOO_LARGE', retry: 'none' } });
    expect(f.requests).toHaveLength(1);
  } finally { await f.tools.close(); }
});
