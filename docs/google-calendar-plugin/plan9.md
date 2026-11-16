# Google Calendar P9 Integrated Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove AC01–AC14 with owned integration tests and measured evidence, without changing implementation source to hide a failure.

**Architecture:** P9 composes the committed runtime fixture, the production embedded MCP handler, deterministic Calendar fixtures, and the P8 assembled HTTP app. Isolated MongoDB and browser checks stay in their own evidence classes. Product defects go back to the owning worker; this plan does not add a second runtime, persistence owner, or reviewer.

**Tech Stack:** TypeScript ESM/NodeNext; Node `^22.22.3 || ^24.15.0 || >=26.0.0`; Vitest 4; Supertest; official MCP client/server `2.3.1`, wire `2026-07-28`; existing in-memory `calendarFixture()` and `nativeDatabase()`; React 19 SSR for Node tests; the existing closed Vite browser fixture, not a new browser runner.

---

## Steps

- [ ] Stop unless the P8 worker is committed. Record the baseline and do not edit implementation source.
- [ ] Add the shared wire helper and scripted malformed/valid/exhausted/policy cases.
- [ ] Add the real embedded MCP handler cases and deterministic Calendar bounds.
- [ ] Add in-memory recovery/limit cases that do not claim native durability.
- [ ] Bind the committed P8 assembly fixture and add assembled HTTP cases.
- [ ] Add isolated MongoDB recovery/accounting e2e that skips without the operator prefix.
- [ ] Add frontend Node integration tests. Run the closed browser fixture separately.
- [ ] Run the package command matrix and legacy regressions. Dispose the live gate without implicit spend.
- [ ] Write `verification.md`, `staging-evidence.md`, and `final_report.md` from measured results only.

## Authority, ownership and execution rules

- Load `executing-plans` before the first edit. Read [goal.md](goal.md), [research.md](research.md), the P9 section of [state.md](state.md), and this plan. Do not ask the orchestrator to read this plan.
- Do not start Task 2 until Task 1 proves the P8 worker is committed. A committed `plan8.md` is not that proof. `operations.md` and `backend/test/assembly/calendar-fixture.ts` must already be in `git log`.
- Own only new files under `backend/test/integration/plugins/**`, `backend/test/plugins/integration/**`, `frontend/src/features/plugins/integration-tests/**`, plus `docs/google-calendar-plugin/verification.md`, `staging-evidence.md`, and `final_report.md`.
- Do not edit `backend/src/**`, `frontend/src/**` outside the reserved integration-test directory, package manifests, lockfiles, contracts, or another worker's tests to make a check pass. A wrong assertion against the frozen contract may be corrected in a P9 file only. A goal violation is a defect handoff, not a local patch.
- Omit the repository documentation-header banner (`FILE` / `LOCATION` / `PURPOSE` / `ROLE IN PROJECT` / `KEY COMPONENTS`) from new P9 files. Backend imports use `.js` specifiers. Frontend test imports use `.ts` / `.tsx` specifiers. No new dependency, root workspace, Playwright, or public MCP route.
- Review is **skipped**, never passed. Do not dispatch a reviewer or a review-triggered fixer. Self-checking this plan is not a review verdict.
- Preserve `3510157`, `1b9b733`, private configuration, and untracked `.openchamber/screenshots/**`. Never `git add .` and never stage `.openchamber/screenshots/**`. Run Git from the checkout root. Run package commands in `backend/` or `frontend/` as labeled. Do not chain commands with `&&`. Run each verification command as its own invocation and record `$LASTEXITCODE`.
- Do not print `AURVIN_TEST_MONGODB_URI`, OAuth tokens, client secrets, or provider keys. Do not provision Google, MongoDB, OpenRouter, accounts, or deployment. Do not spend unless Task 11 finds an already exact live authorization.
- Backend discovery: `npm test` includes `**/*.spec.ts` and excludes `**/*.e2e-spec.ts`. `npm run test:e2e` includes only `**/*.e2e-spec.ts`. Frontend `npm test` includes only `src/**/*.test.ts` in a Node environment. A browser result is not a Node Vitest result. `npm run test:azure` and `npm run test:behavior` can exit 0 with no discovered tests; that is not evidence.

## File map and responsibilities

| File | Responsibility |
| --- | --- |
| `backend/test/plugins/integration/wires.ts` | Canonical create action and malformed create wire. Not a test. |
| `backend/test/plugins/integration/scripted-model.spec.ts` | AC04, AC05, AC06, AC09 attribution on the committed runtime fixture. |
| `backend/test/plugins/integration/embedded-mcp.spec.ts` | AC02 and AC07 through the production handler/fetch path. |
| `backend/test/plugins/integration/recovery-limits.spec.ts` | AC08 crash windows and AC10 counters on the in-memory fixture. Label them in-memory. |
| `backend/test/plugins/integration/assembled.ts` | One binding to the committed P8 fixture. No second `AppService`. |
| `backend/test/plugins/integration/assembled-http.spec.ts` | AC01, AC06, AC11 transport, AC12 origin, AC13 assembly over HTTP. |
| `backend/test/integration/plugins/recovery-accounting.native.e2e-spec.ts` | AC03/AC08/AC09 isolated MongoDB. Skip, do not pass, when prerequisites are absent. |
| `frontend/src/features/plugins/integration-tests/calendar-node-flows.test.ts` | AC11/AC12 Node SSR and protocol checks. Explicitly not browser evidence. |
| `docs/google-calendar-plugin/verification.md` | Commit set, environment, command matrix, AC matrix, skips and blocks. |
| `docs/google-calendar-plugin/staging-evidence.md` | Browser observations and live/native/service disposition. |
| `docs/google-calendar-plugin/final_report.md` | Tested subset, named gates, review skipped, completion pending when blocked. |

## AC coverage inside this plan

| ID | P9 proof | If it fails, return to |
| --- | --- | --- |
| AC01 | Assembled default-off/identity/CSRF cases plus Node disclosure | P3, P8 |
| AC02 | Unmocked `EmbeddedCalendarExecution` plus re-run of `plugins/mcp` | P5 |
| AC03 | Native reconnect of connection/operation records; OAuth suite re-run | P2, P3 |
| AC04 | Malformed-then-valid once; two-repair exhaustion executes zero | P4, P6 |
| AC05 | `attendees`, unknown tool, and missing canonical intent are not repairs | P4, P5, P6 |
| AC06 | Repair history has the user input once and no rejected tool message; assembled SSE sequence | P4, P6, P8 |
| AC07 | MCP create uses the saved event ID and `sendUpdates=none` | P5, P6 |
| AC08 | In-memory crash windows plus native same-ID reconnect | P2, P6, P8 |
| AC09 | Every scripted body has server `user`; native dispatch is not double-counted | P2, P4, P6 |
| AC10 | Repair counter stops at 2; 31-day list is admitted and 31 days plus 1 second is not | P4, P5, P6 |
| AC11 | Node receipt/retry/scrub markup; browser fixture recorded separately | P7, P8 |
| AC12 | Repair prompt excludes raw malformed JSON; hostile origin fails closed; no secret in model body | P4, P7, P8 |
| AC13 | Assembled HTTP flow plus full package commands and voice/config/canvas re-runs | P8 and the failing owner |
| AC14 | The three evidence documents, exact hashes, review skipped, G8/G9 named | P9 handoff; V remains orchestrator-owned |

## Verification command matrix

Run these from the labeled directory after the owned tests exist. Record UTC, exit code, discovered file count, passed, failed, and skipped. A skip is not a pass. An empty Azure or behavior discovery is not a pass.

| Label | Directory | Command |
| --- | --- | --- |
| Backend build | `backend/` | `npm run build` |
| Backend lint | `backend/` | `npm run lint` |
| Backend unit | `backend/` | `npm test` |
| Backend e2e | `backend/` | `npm run test:e2e` |
| Frontend build | `frontend/` | `npm run build` |
| Frontend lint | `frontend/` | `npm run lint` |
| Frontend Node | `frontend/` | `npm test` |
| Scripted model | `backend/` | `npm test -- test/plugins/integration/scripted-model.spec.ts` |
| Embedded MCP | `backend/` | `npm test -- test/plugins/integration/embedded-mcp.spec.ts` |
| Recovery/limits | `backend/` | `npm test -- test/plugins/integration/recovery-limits.spec.ts` |
| Assembled HTTP | `backend/` | `npm test -- test/plugins/integration/assembled-http.spec.ts` |
| Owner MCP | `backend/` | `npm test -- plugins/mcp` |
| Owner repair/stream | `backend/` | `npm test -- model/calendar-repair model/calendar-repair-flow model/strict-json model/calendar-stream` |
| Owner OAuth | `backend/` | `npm test -- plugins/google-calendar/oauth plugins/google-calendar/connection plugins/google-calendar/setup` |
| Owner runtime | `backend/` | `npm test -- runtime/calendar context/calendar` |
| Legacy voice/config/canvas | `backend/` | `npm test -- test/assembly/voice-context.spec.ts test/voice test/assembly/admin-config.spec.ts` |
| Frontend legacy | `frontend/` | `npm test -- src/features/chat/integration-tests/welcome-and-safe-render.test.ts src/App.assembly.test.ts` |
| Native P9 | `backend/` | `npm run test:e2e -- test/integration/plugins/recovery-accounting.native.e2e-spec.ts` |
| Not evidence | `backend/` | `npm run test:azure` and `npm run test:behavior` |

Focused form for one name is `npm test -- <relative-test-path> -t "<test-name>"`.

## Task 1: Confirm the P8 worker gate and record the baseline

**Files:** Read only. Create nothing.

- [ ] **Step 1: Confirm branch and that P8 execution is committed.**

```powershell
git status --short
git branch --show-current
git log -1 --format=%H
git log -1 --format=%H -- docs/google-calendar-plugin/operations.md
git log -1 --format=%H -- backend/test/assembly/calendar-fixture.ts
```

Expected: branch `codex/google-calendar-plugin`. Both `operations.md` and `backend/test/assembly/calendar-fixture.ts` have commit hashes. `.openchamber/screenshots/**` may be untracked; leave them untracked. If either hash is missing, stop and report gate `P9-GATE-P8-WORKER`. Do not write tests against an uncommitted P8 tree.

- [ ] **Step 2: Record environment without secrets.**

```powershell
node -p "process.version"
npm -v
```

Expected: Node matches `^22.22.3 || ^24.15.0 || >=26.0.0`. If it does not, stop and report `P9-GATE-NODE`. Do not upgrade Node from this plan.

- [ ] **Step 3: Read the committed P8 fixture export once.**

Open `backend/test/assembly/calendar-fixture.ts` and `docs/google-calendar-plugin/operations.md`. Write down the exported factory name and whether it returns `app`, `modelWires`, `modelBodies`, `effects`, and `dispose`. Do not modify those files. Task 6 uses that name.

## Task 2: Add the shared wire helper

**Files:** Create `backend/test/plugins/integration/wires.ts`.

- [ ] **Step 1: Create the helper.**

```typescript
import { calendarInputSchemas, type CalendarCreateInput } from '../../../src/contracts/calendar-tools.js';
import { nativeFrame } from '../../model/calendar-fixtures.js';

export const VISIT: CalendarCreateInput = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Visit',
  start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z',
  timeZone: 'Etc/UTC',
});

export const APPROVED_CREATE = `Create this Google Calendar event: ${JSON.stringify(VISIT)}`;

export function malformedCreateWire(): string {
  return nativeFrame({
    role: 'assistant',
    tool_calls: [{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'calendar_create_event', arguments: '{"summary":' },
    }],
  }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

export function forbiddenCreateWire(): string {
  return nativeFrame({
    role: 'assistant',
    tool_calls: [{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: {
        name: 'calendar_create_event',
        arguments: JSON.stringify({ ...VISIT, attendees: ['person@example.com'] }),
      },
    }],
  }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

export function unknownToolWire(): string {
  return nativeFrame({
    role: 'assistant',
    tool_calls: [{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'calendar_delete_event', arguments: '{}' },
    }],
  }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}
```

- [ ] **Step 2: Commit the helper alone.**

```powershell
git add -- "backend/test/plugins/integration/wires.ts"
git commit -m "test(calendar): add P9 scripted wire helper"
git log -1 --stat
```

Expected: only `wires.ts` is in that commit.

## Task 3: Scripted malformed, valid, and exhausted model cases

**Files:** Create `backend/test/plugins/integration/scripted-model.spec.ts`. Test command: `npm test -- test/plugins/integration/scripted-model.spec.ts`.

- [ ] **Step 1: Write the four cases.**

```typescript
import { expect, it } from 'vitest';
import type { NativeCalendarModelMessage } from '../../../src/contracts/calendar-model.js';
import { calendarFixture, createWire, nativeWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT, forbiddenCreateWire, malformedCreateWire, unknownToolWire } from './wires.js';

const REPAIR_SENTENCE = 'The previous tool decision failed structural validation.';

function bodies(h: ReturnType<typeof calendarFixture>) {
  return h.modelBodies as Array<{ user?: string; messages: NativeCalendarModelMessage[] }>;
}

it('repairs one malformed create and executes the valid call once', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), createWire(VISIT, 'create-one'), textWire('Created.'));
    await h.execute(ids);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: 3, repairs: 1, creates: 1 });
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(1);
    expect(bodies(h).every((body) => body.user === h.identity.openRouterUser)).toBe(true);
    const repair = bodies(h)[1].messages;
    expect(repair.filter((message) => message.role === 'user' && message.content === APPROVED_CREATE)).toHaveLength(1);
    expect(repair.some((message) => message.role === 'tool' || 'tool_calls' in message)).toBe(false);
    expect(repair.at(-1)?.content).toContain(REPAIR_SENTENCE);
    expect(repair.at(-1)?.content).not.toContain('{"summary":');
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId);
    expect(messages.items.filter((item) => item.role === 'user')).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

it('exhausts two structural repairs and executes zero rejected creates', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), malformedCreateWire(), malformedCreateWire(), createWire(VISIT, 'unused'));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ repairs: 2, creates: 0 });
    expect(budget?.modelDispatches).toBe(3);
    expect(h.effects).toEqual([]);
    expect(h.modelWires).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

it('does not repair an attendees override', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(forbiddenCreateWire(), textWire('No.'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects.filter((effect) => effect.kind === 'create')).toEqual([]);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget?.repairs ?? 0).toBe(0);
    expect(budget?.creates ?? 0).toBe(0);
    expect(JSON.stringify(bodies(h))).not.toContain(REPAIR_SENTENCE);
  } finally {
    await h.dispose();
  }
});

it('does not repair an unknown tool into a create', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(unknownToolWire(), textWire('No.'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects).toEqual([]);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget?.repairs ?? 0).toBe(0);
    expect(budget?.creates ?? 0).toBe(0);
    expect(JSON.stringify(bodies(h))).not.toContain(REPAIR_SENTENCE);
  } finally {
    await h.dispose();
  }
});

it('does not create when the accepted input is not a canonical event', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Please add something to my calendar tomorrow');
    h.modelWires.push(createWire(VISIT, 'not-authorized'), textWire('What date, start, end, and timezone should I use?'));
    await h.execute(ids).catch(() => undefined);
    expect(h.effects.filter((effect) => effect.kind === 'create')).toEqual([]);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget?.repairs ?? 0).toBe(0);
    expect(budget?.creates ?? 0).toBe(0);
  } finally {
    await h.dispose();
  }
});

it('cancels during correction and executes the rejected call zero times', async () => {
  const h = calendarFixture();
  const controller = new AbortController();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(nativeWire('{"eventId":'));
    h.onPhase = (phase) => {
      if (phase === 'repairing') controller.abort();
    };
    await expect(h.execute(ids, controller.signal)).rejects.toBeDefined();
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toHaveLength(1);
    expect((await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.repairs).toBe(0);
  } finally {
    await h.dispose();
  }
});

it('keeps one user input after a read repair and checkpoint restart', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(nativeWire('{"eventId":'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    expect(h.effects.filter((effect) => effect.kind === 'get')).toHaveLength(1);
    await h.restart();
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId);
    expect(messages.items.filter((item) => item.role === 'user')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(3);
  } finally {
    await h.dispose();
  }
});
```

- [ ] **Step 2: Run the file.**

```powershell
npm test -- test/plugins/integration/scripted-model.spec.ts
```

Expected when P4/P6 match the goal: 7 passed. `PROVIDER_ERROR` / message `The Calendar request could not be corrected.` is the committed exhaustion failure. If a case executes a rejected call, repairs more than twice, repairs an `attendees` or unknown-tool decision, duplicates the user input, or omits `user`, stop. Report the test name, exit code, and owner from the AC table. Do not edit `backend/src`.

- [ ] **Step 3: Commit only this spec.**

```powershell
git add -- "backend/test/plugins/integration/scripted-model.spec.ts"
git commit -m "test(calendar): cover scripted repair exhaustion and policy separation"
git log -1 --stat
```

If Step 2 failed on a goal violation, still commit this reproducer and stop the completion path. Do not weaken the assertions.

## Task 4: Real embedded MCP handler and deterministic Calendar fixtures

**Files:** Create `backend/test/plugins/integration/embedded-mcp.spec.ts`.

- [ ] **Step 1: Write the production-handler cases.**

```typescript
import { expect, it } from 'vitest';
import { CALENDAR_LIMITS, CALENDAR_MCP_WIRE } from '../../../src/contracts/calendar-policy.js';
import { EmbeddedCalendarExecution } from '../../../src/plugins/mcp/calendar-client.js';
import {
  apiToolsFixture,
  googleEvent,
  googleJson,
  type ApiToolsFixture,
} from '../google-calendar/tools-fixtures.js';

const LIST_STEP = {
  method: 'GET',
  path: '/calendar/v3/calendars/owned/events',
  response: () => googleJson({ timeZone: 'Etc/UTC', items: [googleEvent()] }),
};
const GET_STEP = {
  method: 'GET',
  path: '/calendar/v3/calendars/owned/events/abcde01234',
  response: () => googleJson(googleEvent()),
};

function live(fixture: ApiToolsFixture): ApiToolsFixture {
  fixture.input.binding = {
    ...fixture.input.binding,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  };
  return fixture;
}

async function invoke(fixture: ApiToolsFixture, wires: string[]) {
  const host = new EmbeddedCalendarExecution({
    tools: fixture.tools,
    gate: fixture.gate,
    limits: CALENDAR_LIMITS,
    observeRequest(request) {
      expect(new URL(request.url).hostname).toBe('aurvin.internal');
      expect(request.headers.has('authorization')).toBe(false);
      const wire = request.headers.get('mcp-protocol-version');
      if (wire) wires.push(wire);
    },
  });
  try {
    return await host.invoke(fixture.input);
  } finally {
    await host.close();
    expect(host.openChannels).toBe(0);
  }
}

it('discovers and calls the three tools through the production handler', async () => {
  const wires: string[] = [];
  const list = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z', maxResults: 20 },
    },
  }));
  const got = live(apiToolsFixture({
    operation: null,
    steps: [GET_STEP],
    call: { name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } },
  }));
  const created = live(apiToolsFixture());
  expect(await invoke(list, wires)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_events' } });
  expect(await invoke(got, wires)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_get_event' } });
  const create = await invoke(created, wires);
  expect(create).toMatchObject({ outcome: 'success', result: { tool: 'calendar_create_event' } });
  if (create.outcome !== 'success') throw new Error('create failed');
  expect(create.receipt?.googleEventId).toBe(created.input.binding.operation?.googleEventId);
  expect(wires.filter((wire) => wire === CALENDAR_MCP_WIRE).length).toBeGreaterThanOrEqual(2);
  expect(wires.every((wire) => wire === CALENDAR_MCP_WIRE)).toBe(true);
  const post = created.requests[0];
  const url = new URL(post.url);
  expect(post.method).toBe('POST');
  expect(url.pathname).toBe('/calendar/v3/calendars/owned/events');
  expect(url.searchParams.get('sendUpdates')).toBe('none');
  expect(url.searchParams.get('conferenceDataVersion')).toBe('0');
  expect(url.searchParams.get('supportsAttachments')).toBe('false');
  expect(created.requests).toHaveLength(1);
});

it('rejects a 31-day-plus-one-second list before Google and admits the exact 31-day boundary', async () => {
  const over = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-11-21T00:00:01Z', maxResults: 20 },
    },
  }));
  expect(await invoke(over, [])).toMatchObject({ outcome: 'failure' });
  expect(over.requests).toHaveLength(0);
  const edge = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-11-21T00:00:00Z', maxResults: 20 },
    },
  }));
  expect(await invoke(edge, [])).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_events' } });
  expect(edge.requests).toHaveLength(1);
});

it('rejects a model-supplied calendar identity before any Google request', async () => {
  const fixture = live(apiToolsFixture({
    operation: null,
    steps: [GET_STEP],
    call: {
      name: 'calendar_get_event',
      arguments: { eventId: 'abcde01234', calendarId: 'other-calendar' },
    },
  }));
  expect(await invoke(fixture, [])).toMatchObject({ outcome: 'failure' });
  expect(fixture.requests).toHaveLength(0);
});
```

- [ ] **Step 2: Run this file and the owner MCP suite.**

```powershell
npm test -- test/plugins/integration/embedded-mcp.spec.ts
npm test -- plugins/mcp
```

Expected: the new file passes, and `plugins/mcp` is discovered and passes. A direct REST-only green run is not AC02. If the new file never observes `2026-07-28`, or a create omits `sendUpdates=none`, stop and return the defect to P5. Do not replace `EmbeddedCalendarExecution` with `CalendarApi`.

- [ ] **Step 3: Commit only the new spec.**

```powershell
git add -- "backend/test/plugins/integration/embedded-mcp.spec.ts"
git commit -m "test(calendar): prove embedded MCP discovery and bounded Calendar fixtures"
git log -1 --stat
```

## Task 5: In-memory recovery and budget boundaries

**Files:** Create `backend/test/plugins/integration/recovery-limits.spec.ts`.

- [ ] **Step 1: Write the crash-window and duplicate-submit cases.**

```typescript
import { expect, it } from 'vitest';
import { calendarFixture, createWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT } from './wires.js';

it.each([
  ['decision-save', 1, 0],
  ['result-save', 1, 1],
  ['receipt-save', 1, 1],
] as const)('in-memory crash at %s does not repeat inference or allocate a new create', async (point, models, creates) => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(createWire(VISIT, 'create-one'));
    h.failOnce(point);
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.restart();
    expect(h.modelBodies).toHaveLength(models);
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(creates);
    const budget = await h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget?.repairs ?? 0).toBe(0);
    expect(budget?.creates ?? 0).toBeLessThanOrEqual(creates);
  } finally {
    await h.dispose();
  }
});

it('readback keeps the original event id after a local receipt failure', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(createWire(VISIT, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const saved = await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(saved?.googleEventId).toBeTruthy();
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const next = await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(next).toMatchObject({ state: 'succeeded', googleEventId: saved!.googleEventId });
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(1);
    expect(h.effects.filter((effect) => effect.kind === 'readback').map((effect) => effect.eventId))
      .toEqual([saved!.googleEventId]);
  } finally {
    await h.dispose();
  }
});

it('reuses the same accepted turn for the same idempotency key', async () => {
  const h = calendarFixture();
  try {
    const first = await h.runtime.submitTurn({
      identity: h.identity,
      sessionId: null,
      content: APPROVED_CREATE,
      idempotencyKey: 'p9-same-key',
    });
    const second = await h.runtime.submitTurn({
      identity: h.identity,
      sessionId: first.sessionId,
      content: APPROVED_CREATE,
      idempotencyKey: 'p9-same-key',
    });
    expect(second.turnId).toBe(first.turnId);
    expect(second.sessionId).toBe(first.sessionId);
  } finally {
    await h.dispose();
  }
});
```

- [ ] **Step 2: Run it and label the result in-memory.**

```powershell
npm test -- test/plugins/integration/recovery-limits.spec.ts
```

Expected: passed cases are in-memory fixture evidence, not native MongoDB and not a Google grant. A second create, a changed event ID, or a replayed model request is a P6 defect. Do not edit runtime source.

- [ ] **Step 3: Commit only this spec.**

```powershell
git add -- "backend/test/plugins/integration/recovery-limits.spec.ts"
git commit -m "test(calendar): cover in-memory crash windows and same-turn reuse"
git log -1 --stat
```

## Task 6: Bind the P8 assembly and prove the HTTP boundary

**Files:** Create `backend/test/plugins/integration/assembled.ts` and `assembled-http.spec.ts`.

- [ ] **Step 1: Bind the factory recorded in Task 1.**

Replace `assembledCalendar` below with the committed export name if it differs. Add only that name. Do not copy the fixture and do not construct `AppService`.

```typescript
import * as assembly from '../../assembly/calendar-fixture.js';

export type AssembledCalendar = {
  app: { getHttpServer(): unknown; close(): Promise<unknown> };
  modelWires: string[];
  modelBodies: Array<Record<string, unknown>>;
  effects: Array<{ kind: string; eventId: string | null }>;
  dispose(): Promise<void>;
};

type Factory = () => AssembledCalendar | Promise<AssembledCalendar>;

export async function openAssembledCalendar(): Promise<AssembledCalendar> {
  const factories = assembly as Record<string, Factory | undefined>;
  const factory = factories.assembledCalendar
    ?? factories.createAssembledCalendar
    ?? factories.openAssembledCalendar;
  if (!factory) throw new Error('P8_FIXTURE_EXPORT_MISSING');
  const opened = await factory();
  if (!opened.app?.getHttpServer || !opened.modelWires || !opened.dispose) {
    throw new Error('P8_FIXTURE_SHAPE_MISSING');
  }
  return opened;
}
```

If this throws `P8_FIXTURE_EXPORT_MISSING` or `P8_FIXTURE_SHAPE_MISSING` after the one-name binding, stop and return the defect to P8. Do not write a substitute composition.

- [ ] **Step 2: Copy the committed local origin, then write the assembled HTTP cases.**

Open the committed P8 HTTP spec and replace `SAME_ORIGIN` below with the exact frontend origin that spec sends. Do not mix `localhost` and `127.0.0.1`. A 404 on `/api/plugins/google-calendar/status` is a P8 route defect, not an origin pass.

```typescript
import { expect, it } from 'vitest';
import request from 'supertest';
import { calendarCompatibleEnvelopeSchema } from '../../../src/contracts/calendar-wire.js';
import { createWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT, malformedCreateWire } from './wires.js';
import { openAssembledCalendar } from './assembled.js';

function streamUrl(path: string): string {
  if (path.startsWith('/api/')) return path;
  return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
}

it('assembled repair create keeps one ordered stream and one server user', async () => {
  const h = await openAssembledCalendar();
  try {
    h.modelWires.push(malformedCreateWire(), createWire(VISIT, 'create-one'), textWire('Created.'));
    const created = await request(h.app.getHttpServer())
      .post('/api/sessions')
      .send({
        sessionId: null,
        content: APPROVED_CREATE,
        idempotencyKey: 'p9-assembled-repair',
        calendarProtocol: 2,
      });
    expect(created.status).toBe(200);
    const streamed = await request(h.app.getHttpServer()).get(streamUrl(String(created.body.streamPath)));
    expect(streamed.status).toBe(200);
    const frames = String(streamed.text).split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(5).trim())));
    expect(frames.map((frame) => frame.sequence)).toEqual(frames.map((_, index) => index));
    expect(frames.some((frame) => frame.event.type === 'calendar-progress'
      && 'phase' in frame.event && frame.event.phase === 'repairing')).toBe(true);
    expect(frames.some((frame) => frame.event.type === 'calendar-operation'
      && 'operation' in frame.event && frame.event.operation.state === 'succeeded')).toBe(true);
    expect(frames.at(-1)?.event.type).toBe('completed');
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(1);
    const serverUser = h.modelBodies[0]?.user;
    expect(typeof serverUser).toBe('string');
    expect(String(serverUser).length).toBeGreaterThan(0);
    expect(h.modelBodies.every((body) => body.user === serverUser)).toBe(true);
    expect(JSON.stringify(h.modelBodies)).not.toMatch(/fixture-access-token|refresh_token|client_secret/i);
  } finally {
    await h.dispose();
  }
}, 20_000);

const SAME_ORIGIN = 'http://127.0.0.1:5173';

it('rejects a client identity override and a hostile setup origin before an effect', async () => {
  const h = await openAssembledCalendar();
  try {
    const status = await request(h.app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .set('Origin', SAME_ORIGIN);
    expect(status.status).not.toBe(404);
    const override = await request(h.app.getHttpServer())
      .post('/api/sessions')
      .set('Origin', SAME_ORIGIN)
      .send({
        sessionId: null,
        content: APPROVED_CREATE,
        idempotencyKey: 'p9-identity-override',
        calendarProtocol: 2,
        userId: 'browser-user',
      });
    expect(override.status).toBeGreaterThanOrEqual(400);
    expect(override.status).not.toBe(404);
    const hostile = await request(h.app.getHttpServer())
      .post('/api/plugins/google-calendar/settings')
      .set('Origin', 'https://evil.example')
      .set('X-Aurvin-Calendar-CSRF', '1')
      .send({ enabled: true });
    expect(hostile.status).toBe(403);
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toEqual([]);
  } finally {
    await h.dispose();
  }
});
```

- [ ] **Step 3: Run the assembled file and the committed P8 flow file.**

```powershell
npm test -- test/plugins/integration/assembled-http.spec.ts
npm test -- test/assembly/calendar-flow.spec.ts
```

Expected: both files are discovered. The P8 file supplies blank-config, plugin-outage, and drain cases; do not reimplement them. If the P9 file fails because the stream path, status code, or frame sequence disagrees with the committed P8 spec, prefer the committed P8 contract and correct only the P9 assertion when the goal invariants still hold: one create, ordered sequences, server user, no secret, hostile origin not accepted. If those invariants fail, return the defect to P8.

- [ ] **Step 4: Commit the two new files.**

```powershell
git add -- "backend/test/plugins/integration/assembled.ts" "backend/test/plugins/integration/assembled-http.spec.ts"
git commit -m "test(calendar): cover assembled HTTP repair and boundary rejection"
git log -1 --stat
```

## Task 7: Isolated MongoDB recovery and accounting

**Files:** Create `backend/test/integration/plugins/recovery-accounting.native.e2e-spec.ts`. The suffix must be `.e2e-spec.ts` so `npm test` does not discover it.

- [ ] **Step 1: Write the skip-guarded native proof.**

```typescript
import { expect, it, describe } from 'vitest';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../../src/persistence/persistence.js';
import { budget, connection, dispatch, operation, operationEvent } from '../../persistence/calendar-fixtures.js';
import { nativeDatabase } from '../../persistence/native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('P9 isolated Calendar recovery and accounting', () => {
  it('reconnects the same event id and does not double-count a dispatch', async () => {
    const isolated = await nativeDatabase();
    try {
      expect(isolated.name.startsWith('aurvin_p2_test_')).toBe(true);
      expect(isolated.name.includes('aurvin') && isolated.name.length > 'aurvin_p2_test_'.length).toBe(true);
      const hello = await isolated.client.db('admin').command({ hello: 1 });
      expect(hello.isWritablePrimary).toBe(true);
      const topology = typeof hello.setName === 'string' ? 'replica-set' : 'standalone';
      expect(['replica-set', 'standalone']).toContain(topology);
      const bundle = await createPersistenceBundle(isolated.client, isolated.name, DEFAULT_BUDGETS, 'p9-executor');
      try {
        expect((await bundle.calendarConnections.create(connection())).outcome).toBe('confirmed');
        const reserved = await bundle.calendarOperations.reserve(operation());
        expect(reserved.outcome).toBe('created');
        await bundle.calendarOperations.appendEvent(operationEvent());
        await bundle.calendarAccounting.createBudget(budget());
        await bundle.calendarAccounting.putDispatch(dispatch());
        await bundle.calendarAccounting.putDispatch(dispatch());
        expect(await bundle.calendarAccounting.getBudget('u1', 's1', 't1')).toMatchObject({
          modelDispatches: 1,
          reservedUsd: '0.25',
        });
      } finally {
        await bundle.owner.releaseExecutor();
      }
      const nextClient = await isolated.reconnect();
      try {
        const reopened = await createPersistenceBundle(nextClient, isolated.name, DEFAULT_BUDGETS, 'p9-executor');
        try {
          const again = await reopened.calendarOperations.reserve({ ...operation(), originatingAttemptId: 'a2' });
          expect(again.outcome).toBe('existing');
          const saved = await reopened.calendarOperations.getByTurn('u1', 's1', 't1');
          expect(saved?.googleEventId).toBe(operation().googleEventId);
          expect(await reopened.calendarAccounting.getBudget('u1', 's1', 't1')).toMatchObject({
            modelDispatches: 1,
            reservedUsd: '0.25',
          });
          const rows = await isolated.db.collection('metadata').find({ kind: 'calendar-model-dispatch' }).toArray();
          expect(rows).toHaveLength(1);
          expect(JSON.stringify(rows)).not.toMatch(/mongodb:\/\//i);
        } finally {
          await reopened.owner.releaseExecutor();
        }
      } finally {
        await nextClient.close();
      }
    } finally {
      await isolated.close();
    }
  });
});
```

- [ ] **Step 2: Run it once without printing the URI.**

```powershell
npm run test:e2e -- test/integration/plugins/recovery-accounting.native.e2e-spec.ts
```

Expected with both `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`: 1 passed, database name starts with `aurvin_p2_test_`, and the URI is absent from output. Expected without either value: 1 skipped, not 1 passed. Record `standalone` when `hello.setName` is absent; that is a topology limitation, not replica-set certification and not a skip. Do not point the fixture at an application database. Do not install MongoDB.

- [ ] **Step 3: Commit only the e2e file.**

```powershell
git add -- "backend/test/integration/plugins/recovery-accounting.native.e2e-spec.ts"
git commit -m "test(calendar): add isolated native recovery and accounting proof"
git log -1 --stat
```

## Task 8: Frontend Node integration tests

**Files:** Create `frontend/src/features/plugins/integration-tests/calendar-node-flows.test.ts`. This file is Node Vitest. It must not open a browser.

- [ ] **Step 1: Write the Node flow checks.**

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarClient } from '../../../api/calendar-client.ts';
import {
  CALENDAR_CSRF_HEADER,
  extractAndScrubCalendarOAuthCallback,
  parseCalendarCompatibleFrame,
  type CalendarPublicStatus,
  type CalendarTurnState,
} from '../../../api/calendar-protocol.ts';
import { CalendarTurnView } from '../google-calendar/CalendarTurnRegion.tsx';
import { GoogleCalendarPanel } from '../google-calendar/GoogleCalendarPanel.tsx';

const status: CalendarPublicStatus = {
  protocolVersion: 1,
  state: 'disabled',
  enabled: false,
  accountEmail: null,
  targetCalendarId: 'disposable-test@group.calendar.google.com',
  processingDisclosure: {
    policyId: 'policy-local-1',
    processors: 'Google, OpenRouter and the configured model provider',
    dataCollection: 'deny',
  },
};

function client(): CalendarClient {
  return {
    getStatus: vi.fn(async () => status),
    updateSettings: vi.fn(async () => status),
    startOAuth: vi.fn(async () => ({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s',
    })),
    disconnect: vi.fn(async () => ({ disconnected: true, remoteRevocation: 'not-requested' })),
  };
}

const receipt: CalendarTurnState = {
  operationId: 'op-node-1',
  state: 'succeeded',
  narration: 'failed',
  retryAction: 'none',
  receipt: {
    durable: true,
    eventId: 'evtnode123',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=evtnode123',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
};

describe('P9 Calendar Node flows', () => {
  it('does not treat this Node suite as browser evidence', () => {
    expect(typeof document).toBe('undefined');
  });

  it('renders default-off disclosure and a durable receipt without a secret href', () => {
    const panel = renderToStaticMarkup(createElement(GoogleCalendarPanel, {
      client: client(),
      initialStatus: status,
    }));
    expect(panel).toContain('Disabled (default off)');
    expect(panel).toContain('Single-user local proof');
    expect(panel).not.toContain('access_token');
    const turn = renderToStaticMarkup(createElement(CalendarTurnView, {
      progress: 'repairing',
      operations: [{ turnId: 'turn-node-1', operation: receipt }],
      disabled: false,
      nowMs: Date.parse('2026-10-21T00:00:00.000Z'),
      onRetryTurn: () => undefined,
    }));
    expect(turn).toContain('Correcting the Calendar request');
    expect(turn).toContain('The Calendar event was created and saved, but the final assistant response failed.');
    expect(turn).toContain('evtnode123');
    expect(turn).toContain('https://calendar.google.com/calendar/event?eid=evtnode123');
    expect(turn).not.toContain('javascript:');
  });

  it('scrubs OAuth code and state and parses a v2 repairing frame', () => {
    const scrubbed = extractAndScrubCalendarOAuthCallback(
      'http://127.0.0.1:5173/?plugin=google-calendar&oauth=fixture&code=secret-code&state=secret-state',
    );
    expect(scrubbed.outcome).toBe('fixture');
    expect(scrubbed.hadSensitiveParams).toBe(true);
    expect(scrubbed.scrubbedPathAndSearch).not.toContain('code=');
    expect(scrubbed.scrubbedPathAndSearch).not.toContain('state=');
    const frame = parseCalendarCompatibleFrame('data: ' + JSON.stringify({
      protocolVersion: 2,
      sessionId: 'sess-cal-1',
      turnId: 'turn-cal-1',
      attemptId: 'att-cal-1',
      sequence: 0,
      event: { type: 'calendar-progress', phase: 'repairing' },
    }));
    expect(frame.event).toMatchObject({ type: 'calendar-progress', phase: 'repairing' });
    expect(CALENDAR_CSRF_HEADER).toBe('X-Aurvin-Calendar-CSRF');
  });
});
```

- [ ] **Step 2: Run it from `frontend/`.**

```powershell
npm test -- src/features/plugins/integration-tests/calendar-node-flows.test.ts
```

Expected: 3 passed in Node. `typeof document === 'undefined'` must pass. Do not add jsdom or Playwright to make it look like a browser test. A markup failure returns to P7.

- [ ] **Step 3: Commit only the Node test.**

```powershell
git add -- "frontend/src/features/plugins/integration-tests/calendar-node-flows.test.ts"
git commit -m "test(frontend): add Calendar node integration flows"
git log -1 --stat
```

## Task 9: Browser evidence, separate from Node Vitest

**Files:** No new test runner. Record results later in `staging-evidence.md`. The fixture already exists at `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html`.

- [ ] **Step 1: Start only the frontend dev server.**

From `frontend/`:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Leave it running. Do not start a live backend for this fixture. The fixture refuses non-development execution, so do not use `vite preview`.

- [ ] **Step 2: Open the closed fixture and read its own checklist.**

Open `http://127.0.0.1:5173/src/features/plugins/google-calendar/testing/calendar-browser.html`. Wait until `#fixture-status` is no longer `Running checks`. Record the exact status text, which the fixture sets to `<passed>/<total> passed`, and every `#fixture-checks` item. A pass requires `passed === total` and `total > 0`. Also record that the address bar no longer contains `code=` or `state=`.

This is browser evidence. It does not replace Task 8 and it does not certify a Google grant. If the browser cannot be driven, record `browser: blocked` and the reason. Do not mark AC11 fully passed from Node tests alone. A failed checklist item returns to P7; do not edit the panel.

- [ ] **Step 3: Stop the dev server started in Step 1.**

Do not leave the Vite process running. Do not commit screenshots.

## Task 10: Package matrix and legacy regressions

**Files:** No source edits. The results feed Task 12.

- [ ] **Step 1: Run the seven required package commands as separate invocations.**

From `backend/`:

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

From `frontend/`:

```powershell
npm run build
npm run lint
npm test
```

Record UTC, exit code, and the tool's own file/test counts. `npm test` must discover `test/plugins/integration/*.spec.ts`. `npm run test:e2e` must discover `test/integration/plugins/recovery-accounting.native.e2e-spec.ts` as passed or skipped, never as absent. Frontend `npm test` must discover `src/features/plugins/integration-tests/calendar-node-flows.test.ts`.

- [ ] **Step 2: Run the legacy and owner commands from the matrix.**

Run each row in the verification command matrix as its own invocation. Include voice, admin-config, canvas/welcome, OAuth, runtime, and MCP owner suites. A failure returns to the suite owner. Do not delete or skip an old test to make the command exit 0.

- [ ] **Step 3: Run the non-evidence commands and label them.**

From `backend/`:

```powershell
npm run test:azure
npm run test:behavior
```

Record exit code and discovered test count. Exit 0 with no tests does not pass any AC. Do not treat either command as Calendar certification.

## Task 11: Live gate disposition without implicit spend

**Files:** No service calls unless every authorization input below is already present.

- [ ] **Step 1: Look for an existing exact authorization. Do not create one.**

Read `docs/google-calendar-plugin/operations.md`. List environment **names** only:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match 'AURVIN_GOOGLE|AURVIN_LIVE|OPENROUTER|GOOGLE' } | Select-Object -ExpandProperty Name
```

G8 is authorized only when all of these already exist: a Google project/consent configuration, the operator grant, a disposable owned calendar, exact event data and cleanup authority, a tool-capable model with an approved external-data policy, and a bounded spend limit. Goal approval is not that authorization. `AURVIN_LIVE_SMOKE=authorized` is the old text smoke, not Calendar create permission.

- [ ] **Step 2: If any input is missing, record the block and stop.**

Write `G8 blocked / live acceptance unrun` in the evidence documents. Do not call Google or OpenRouter. Do not request a duplicate grant. Completion stays pending.

- [ ] **Step 3: If, and only if, the exact authorization already exists, run one bounded create/readback/safe-retry.**

Use the disposable calendar and the exact permitted event. Persist the operation's event ID before the live POST. Read back that same ID. Retry the same accepted input and assert one event, not a second ID. Record the event ID, link, and whether cleanup was actually performed. Do not print tokens. If readback or the safe retry fails, record the failure and leave completion pending. Do not allocate a new event ID to make the retry look successful.

G9 stays blocked unless `operations.md` cites actual Google terms, observed retention headers, and an approved provider routing/retention policy. A policy id in configuration is not that evidence.

## Task 12: Write the three evidence documents from measured output

**Files:** Create the three documents below. Replace every measured field from command output. Do not copy a pass from this plan.

- [ ] **Step 1: Write `verification.md` with this structure and measured values.**

```markdown
# Google Calendar plugin verification

Unified review: skipped, not passed. This file does not authorize provisioning, deployment, or live spend.

## Environment

- Date UTC: <measured>
- Branch: codex/google-calendar-plugin
- Test tip: <full hash before these evidence documents>
- P8 worker commit: <full hash of operations.md>
- Node / npm: <measured>
- Native prefix: aurvin_p2_test_
- Native prerequisites present: <yes|no>
- Native topology: <replica-set|standalone|unrun>
- URI printed: no
- Live Calendar: <unrun-blocked|executed>
- Review: skipped

## Commit set

List every full hash from `git log --format=%H 989d6b17d09fc4f0c5393f1f92781030a78b6617..HEAD` that belongs to this plugin work, plus the evidence commit hash reported in the worker handoff. Do not amend this file just to insert its own hash.

## AC matrix

| ID | Result | Evidence | Owner if failed | Limitation |
| --- | --- | --- | --- | --- |
| AC01 | <pass|fail|blocked> | assembled-http.spec.ts and node disclosure | P3/P8 | Local single-user only |
| AC02 | <pass|fail|blocked> | embedded-mcp.spec.ts and plugins/mcp | P5 | Fixture Google, not a live grant |
| AC03 | <pass|fail|skipped|blocked> | native e2e or skip count | P2/P3 | Skip is not a pass |
| AC04 | <pass|fail|blocked> | scripted-model.spec.ts | P4/P6 | Fixture model |
| AC05 | <pass|fail|blocked> | scripted-model.spec.ts | P4/P5/P6 | |
| AC06 | <pass|fail|blocked> | scripted-model.spec.ts and assembled stream | P4/P6/P8 | |
| AC07 | <pass|fail|blocked> | embedded-mcp.spec.ts | P5/P6 | Fixture receipt |
| AC08 | <pass|fail|skipped|blocked> | recovery-limits.spec.ts is in-memory; native e2e is separate | P2/P6/P8 | |
| AC09 | <pass|fail|skipped|blocked> | scripted user field and native dispatch count | P2/P4/P6 | |
| AC10 | <pass|fail|blocked> | exhaustion and 31-day boundary | P4/P5/P6 | |
| AC11 | <pass|fail|blocked> | Node file plus browser status text | P7/P8 | Node is not browser |
| AC12 | <pass|fail|blocked> | repair prompt, hostile origin, browser storage check | P4/P7/P8 | G9 may still block real data |
| AC13 | <pass|fail|blocked> | package matrix and legacy commands | P8 | |
| AC14 | <blocked|pass> | this file, staging-evidence.md, final_report.md | P9 | Review skipped; G8/G9 named |

Use `pass` only when the cited command exited 0 and discovered the cited test. Use `skipped` only for a discovered skip. Use `blocked` when a required prerequisite or live/policy gate is absent.

## Commands

| Directory | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm run build` | <measured> | <measured> | <measured> |
| backend | `npm run lint` | <measured> | <measured> | <measured> |
| backend | `npm test` | <measured> | <measured> | <measured> |
| backend | `npm run test:e2e` | <measured> | <measured> | <passed/failed/skipped> |
| frontend | `npm run build` | <measured> | <measured> | <measured> |
| frontend | `npm run lint` | <measured> | <measured> | <measured> |
| frontend | `npm test` | <measured> | <measured> | <measured> |
| backend | `npm run test:azure` | <measured> | <measured> | not Calendar evidence |
| backend | `npm run test:behavior` | <measured> | <measured> | not Calendar evidence |

Add one row for every focused command actually run.
```

- [ ] **Step 2: Write `staging-evidence.md`.**

```markdown
# Google Calendar plugin staging evidence

Review: skipped, not passed. No deployment is authorized.

## Browser

- URL: `http://127.0.0.1:5173/src/features/plugins/google-calendar/testing/calendar-browser.html`
- Runner: existing closed Vite fixture. Not Node Vitest and not a live Google session.
- Status text: <exact `#fixture-status` text, or blocked reason>
- Checks: <exact list items>
- Address bar contained code/state after load: <yes|no|unobserved>
- Result: <pass|fail|blocked>

## Native

- Prerequisites present: <yes|no>
- Prefix: `aurvin_p2_test_`
- Generated database dropped by the fixture: <yes|unrun>
- Topology: <replica-set|standalone|unrun>
- Replica-set certification: no
- URI printed: no
- Command result: <passed|skipped|failed>

## Live gate

- G8: <blocked / live acceptance unrun|executed>
- Missing inputs: <list, or none>
- Event ID reused on safe retry: <yes|unrun>
- Second event created: <no|yes|unrun>
- G9 real-data policy: <blocked|documented>
- Spend initiated by this plan: <no|exact bounded action already authorized>
```

- [ ] **Step 3: Write `final_report.md`.**

```markdown
# Google Calendar plugin final report

## Disposition

Workflow completion: pending. Unified review: skipped, not passed. The orchestrator accepts or retains this gate; this report does not mark the workflow complete while G8 or G9 is blocked or any required AC is failed, skipped, or blocked.

## Tested subset

State which package commands exited 0, which native tests ran or skipped, and the browser status text. Distinguish in-memory fixture passes from native, browser, and live evidence.

## Named gates

- `P9-GATE-P8-WORKER`: <passed before tests started|blocked>
- G8 live create/readback/safe-retry: <blocked / live acceptance unrun|executed>
- G9 real-data processing admission: <blocked|satisfied by cited operations.md evidence>
- Native MongoDB: <executed|skipped, prerequisites absent>
- Browser: <executed|blocked>
- Review: skipped

## Defects

List each failing command, AC, and owning worker. If there are none, write `none observed` only after the required deterministic commands exited 0. Do not hide a skip inside that sentence.

## Limitations

Local single-user proof. No member isolation. No Azure certification. No public MCP route. Cancellation is not a billing guarantee. A fixture grant is not a Google connection. Standalone MongoDB is not replica-set certification.
```

- [ ] **Step 4: Reject unfinished evidence before committing.**

Search the three documents for `TBD`, `TODO`, `<measured>`, and `<pass|`. None may remain. A blocked gate must say `blocked` or `skipped`, not a blank cell. `pass` must cite an actual exit 0.

```powershell
git add -- "docs/google-calendar-plugin/verification.md" "docs/google-calendar-plugin/staging-evidence.md" "docs/google-calendar-plugin/final_report.md"
git commit -m "docs(google-calendar-plugin): record P9 verification evidence"
git log -1 --stat
git rev-parse HEAD
```

Expected: only those three files are in the commit. Put the evidence hash in the worker handoff. Do not amend the commit to insert it.

## Defect handoff

When a required check fails, report the AC, command, exit code, first assertion, and owner. Leave completion pending. Do not dispatch a fixer. After the owner commits a fix, re-run only the failed command and the package command that discovers it, then update the evidence documents with the new measured result.

## P9 exit checklist

- [ ] P8 worker commit existed before the first test file.
- [ ] Owned tests live only in the three reserved directories.
- [ ] No implementation source was edited to turn a failure into a pass.
- [ ] Scripted malformed, valid, and exhausted cases were executed.
- [ ] The production MCP handler was invoked; a mocked client alone was not accepted as AC02.
- [ ] Deterministic Calendar create asserted `sendUpdates=none` and the saved event ID.
- [ ] Native recovery/accounting either ran against `aurvin_p2_test_` or was reported skipped.
- [ ] Browser evidence is separate from Node Vitest.
- [ ] Backend build, lint, test, and e2e, plus frontend build, lint, and test, have measured results.
- [ ] Azure and behavior commands are labeled not evidence.
- [ ] G8 ran only under an existing exact authorization; otherwise it is `blocked / live acceptance unrun`.
- [ ] The three evidence documents exist and do not claim workflow completion while a required gate is blocked.
- [ ] Review is recorded skipped, never passed.
- [ ] No documentation-header banner was added.
