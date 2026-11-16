# Assembled Workflow, Cache-Shape, and Latency Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave runnable assembled checks and honest task-level evidence for Calendar's compact catalog, local discovery, stable dispatcher, retained history, and normal-path overhead.

**Architecture:** Extend the existing offline AppService/Calendar assembly and BSON-fake latency fixtures; run the actual serializer, streaming adapter, durable runtime, repositories, and Calendar executor with scripted provider responses. Observe outbound requests and execution boundaries without replacing the behavior under test. Compare immutable research measurements with equivalent cold probes, and report new multi-turn measurements separately; do not retain a legacy runtime or introduce a benchmark platform.

**Tech Stack:** Existing Node.js 24, TypeScript ESM/NodeNext (`.js` local imports), Vitest 4, AppService/Nest assembly, existing MongoDB repository fakes and optional isolated native MongoDB; no new dependencies.

---

## Ownership, prerequisites, and honest TDD

- Read [goal.md](goal.md), [state.md](state.md), and research commit `86dd3974d5e000ab05f4d2285879a723fcd3f69f`. P1's planned contract is committed at `e30b1a961057b9a697c137330e9b47aa4b6cc109`.
- **Worker admission:** P1 and P2 implementation, their focused verification, and this plan must all be committed. Planning completion alone is not worker admission. Obtain their exported-contract and fixture-migration summaries before starting. If exported names change, reconcile this plan before writing dependent tests; do not implement an alternate contract in P3.
- P3 owns only necessary tests/fixtures in the six directories assigned in state, minimal existing benchmark adaptation, and `verification.md`. Do not edit production model/runtime/context/persistence/plugins/voice/central wiring, package manifests, frontend, `state.md`, or `final_report.md`. Production failures go to P1/P2, with a reproducer, before rerunning P3.
- **Code review: SKIPPED (`--skip review`).** No review task, reviewer, review artifact, or review-triggered fixer. Test diagnosis and owner-routed corrections remain required.
- All `npm` commands run in `backend`; all `git` commands run at repository root. Run build before suites importing `dist`; never overlap the build with those suites. Serialize staging/commits with the orchestrator, stage named files, and preserve concurrent/untracked user work.
- Every new code file gets the mandatory repository file header before its first import. Add a header to an existing code file if changing over 30%. Snippets below show executable bodies; prepend the header using that file's real filename/location, one-line purpose, project role, and named components. Do not put a code-file header on this document or JSON.
- Each numbered step is one small action. Add one `it` block, run it, implement only its missing fixture/measurement behavior, rerun, and commit. A new harness/export has a genuine missing-module/export red phase. An assembled regression may already be green after P1/P2: record that fact; **never** weaken production, force a failing assertion, or add a fake implementation just to manufacture red. The exact regression below would fail on the pre-change path; it is still valid evidence if upstream already fixed it. A production assertion failure blocks the task and returns to its owner, not a test-only workaround.
- Do not fake authentication/token errors as success, disable accounting spies, increase production budgets, replace history with hand-built messages, or filter native calls out of a failing prefix comparison.
- Existing assembly uses real repositories over fake storage/MemorySaver. This is assembled behavior, not native MongoDB certification. Task 7 separately uses the existing stock-saver/BSON fixture. Native checks remain independently guarded.

## File structure before implementation

Create only these small, concern-specific files:

| Exact path | Responsibility |
| --- | --- |
| `backend/test/assembly/skill-fixture.ts` | Thin reuse of `assembledCalendarApp`, stable SSE wires, turn driver, request/boundary capture. No runtime/loaded-state simulation. |
| `backend/test/assembly/skill-workflow.spec.ts` | Matched ordinary/cold/batch/warm/later-tool paths and exact request/call counts. |
| `backend/test/assembly/skill-history.spec.ts` | Prefix bytes, ordered pairs, acknowledgements, correction, new-chat isolation, clean process reconstruction. |
| `backend/test/assembly/skill-evidence.ts` | Pure request-size/reservation-unit and unavailable-usage projection; test-only, not a reporting service. |
| `backend/test/performance/skill-evidence.spec.ts` | Measurement honesty and immutable baseline cold-probe comparisons. |
| `backend/test/performance/skill-scale.spec.ts` | Synthetic catalog projection/selection/size only; no integration or injected production registry. |
| `backend/test/performance/skill-latency.spec.ts` | Existing `DependencyProbe` and stock-saver whole-runtime measurements. |
| `backend/test/integration/skill-restart.native.e2e-spec.ts` | Optional real-store schema-history survival across stopped restart. |
| `docs/plugin-skill-scalability/verification.md` | Actual commands, commits, measurements, failures/skips, limitations, baseline provenance. |

Reuse, and minimally migrate where the upstream fixture handoff does not already cover it:

- `backend/test/assembly/calendar-capability.spec.ts`, `calendar-flow.spec.ts`, `calendar-multi-flow.spec.ts`, `calendar-observability.spec.ts`, `calendar-simplification.spec.ts`, `calendar-simplification.built.spec.ts`.
- `backend/test/performance/calendar-critical-path.spec.ts`, `durable-latency.spec.ts`.
- Existing regressions under `backend/test/integration/plugins/multi-calendar/`, `backend/test/voice/`, and `backend/test/benchmark/` run unchanged unless an actual stale P3-owned caller is identified. Do not edit every suite preemptively.
- No new file under `backend/src/benchmark/` is needed: existing `analyzeTurn`, `summarize`, `DependencyProbe`, and captured bodies suffice. Request explicit ownership reconciliation if evidence establishes otherwise.

## Task 1: Add one observational assembly fixture

**Files:** Create `backend/test/assembly/skill-fixture.ts`; create `backend/test/assembly/skill-workflow.spec.ts`.

- [ ] **Step 1: Add this exact first regression to `skill-workflow.spec.ts`.**

```typescript
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, compactSkillCatalog } from '../../src/contracts/calendar-tools.js';
import { skillAssembly, textWire } from './skill-fixture.js';

it('runs an eligible ordinary question with two tools and no plugin work', async () => {
  const h = await skillAssembly();
  try {
    const turn = await h.turn('What is 2 + 2?', [textWire('4.')]);
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(1);
    expect(turn.bodies[0]!.tools?.map(t => t.function.name))
      .toEqual(['activate_skill', 'call_tool']);
    const initial = turn.bodies[0]!.messages;
    const prefix = initial.slice(0, initial.findIndex(m => m.role === 'user'))
      .map(m => m.content ?? '').join('\n');
    const catalog = compactSkillCatalog();
    expect(prefix).toContain(catalog.plugin);
    for (const tool of catalog.tools) {
      expect(prefix).toContain(tool.name);
      expect(prefix).toContain(tool.description);
    }
    expect(prefix).not.toContain('"inputSchema"');
    for (const tool of CALENDAR_TOOLS) expect(prefix).not.toContain(JSON.stringify(tool.inputSchema));
    expect(h.snapshot()).toEqual(h.boundaries[0]);
    expect(h.snapshot().external).toBe(0);
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red.** `npm test -- test/assembly/skill-workflow.spec.ts -t "eligible ordinary question"`

Expected first failure: cannot resolve `./skill-fixture.js`. Once the harness exists, failure on five native tools or missing tools is a P1/P2 integration defect, not permission to change the expectation.

- [ ] **Step 3: Write the minimal fixture below.** Keep the existing assembly's provider implementation and repositories; intercept only for observation. `snapshot()` excludes normal local admission/account-current reads: these are not a new authorization preflight. It includes target resolution/credential/resource-discovery work that local schema loading must never invoke. Restore every spy on disposal and on setup failure.

```typescript
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
      source: 'server-configured' }, sessionId, content, idempotencyKey: `skill-evidence-${++serial}` });
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
```

Before writing the import, confirm the actual existing class export in `backend/src/plugins/google-calendar/discovery.ts` is `CalendarDiscoveryService`; if upstream renamed it, use that exported class in this fixture only. Do not create a substitute service. All other names above were traced in the current checkout. Do not use `compiled:true` with source-class spies; Task 6 retains the separate built regression.

- [ ] **Step 4: Verify green.** Repeat the focused command, then `npm test -- test/assembly/skill-workflow.spec.ts test/assembly/calendar-capability.spec.ts`. Classify a stale old-five-tools capability assertion for Task 6; do not report this combined command green until corrected.
- [ ] **Step 5: Commit:**

```powershell
git add backend/test/assembly/skill-fixture.ts backend/test/assembly/skill-workflow.spec.ts
git commit -m "test(skills): observe real assembled requests and discovery boundaries"
```

## Task 2: Prove matched cold, batched, warm, and later-tool workflows

**File:** Modify `backend/test/assembly/skill-workflow.spec.ts` (append blocks and named imports from `skill-fixture.ts`).

- [ ] **Step 1: Add this exact parameterized test.** Merge `loadWire`, `callWire`, and `USER` into the existing `./skill-fixture.js` import; reuse the Task 1 `CALENDAR_TOOLS` import. Use unique raw call IDs rather than the runtime fixture's specially rewritten `call_1`.

```typescript
it.each([
  { name: 'one operation', tools: ['calendar_list_calendars'], mode: 'one', requests: 3 },
  { name: 'multiple tools in one batch', tools: ['calendar_list_calendars', 'calendar_get_event'], mode: 'batch', requests: 4 },
  { name: 'all tools in one disclosure', tools: 'all', mode: 'all', requests: 3 },
] as const)('completes $name without discovery preflights', async row => {
  const h = await skillAssembly();
  try {
    const selection = row.tools === 'all' ? 'all' : [...row.tools];
    const wires = [loadWire(selection, 'cold-load'), callWire('calendar_list_calendars', {}, 'cold-list')];
    if (row.mode === 'batch') wires.push(callWire('calendar_get_event',
      { calendarId: 'owned', eventId: 'abcde' }, 'cold-get'));
    wires.push(textWire('Done.'));
    const turn = await h.turn(row.mode === 'batch'
      ? 'List my calendars and read event abcde on my primary calendar.' : 'List my calendars.', wires);
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(row.requests);
    expect(h.boundaries[1]).toEqual(h.boundaries[0]);
    const message = turn.bodies[1]!.messages.find(m => m.tool_call_id === 'cold-load');
    expect(message).toBeDefined();
    const disclosed = JSON.parse(message!.content!);
    const expectedNames = selection === 'all' ? CALENDAR_TOOLS.map(t => t.name) : selection;
    expect(disclosed.disclosures.map((t: { tool: string }) => t.tool).sort())
      .toEqual([...expectedNames].sort());
    expect(disclosed.alreadyLoaded).toEqual([]);
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual(
      row.mode === 'batch' ? ['calendar_list_calendars', 'calendar_get_event'] : ['calendar_list_calendars']);
    expect(h.spies.oauth).not.toHaveBeenCalled();
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId);
    expect(budget).toMatchObject({ modelDispatches: row.requests, repairs: 0,
      logicalTools: row.mode === 'batch' ? 2 : 1, creates: 0 });
    for (const body of turn.bodies) {
      expect(body.user).toBe(USER);
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(turn.bodies[0]!.tools));
    }
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run red/characterization.** `npm test -- test/assembly/skill-workflow.spec.ts -t "without discovery preflights"`

Expected on the old path: stable activation is rejected or five definitions are sent. Expected after prerequisites: all three cases complete. If `get_event` fixture selection is rejected, inspect the actual executor diagnostic rather than changing the production schema or bypassing permissions; `owned` is seeded by `assembledCalendarApp`.

- [ ] **Step 3: Minimal implementation:** reuse Task 1's wires/driver. No additional production or fixture behavior is needed. Add only these imports:

```typescript
import { skillAssembly, textWire, callWire, loadWire, USER } from './skill-fixture.js';
```

Do not count schema activation as a logical Calendar operation or create allowance. Boundary equality proves zero executor, target/preflight, token, resource-discovery, OAuth, or external calls *between the activation response and its continuation*. Do not demand zero execution-authority checks for the later actual Calendar call.

- [ ] **Step 4: Add and run this exact multi-turn regression.**

```typescript
it('reuses schemas for two follow-ups and loads only a newly needed later tool', async () => {
  const h = await skillAssembly();
  try {
    const first = await h.turn('List my calendars.', [loadWire(['calendar_list_calendars'], 'first-load'),
      callWire('calendar_list_calendars', {}, 'first-list'), textWire('Listed.')]);
    for (const [index, prompt] of ['List them again.', 'Repeat that list.'].entries()) {
      const start = h.boundaries.length;
      const warm = await h.turn(prompt, [callWire('calendar_list_calendars', {}, `warm-list-${index}`),
        textWire('Listed again.')], first.ids.sessionId);
      expect(warm.status).toBe('completed');
      expect(warm.bodies).toHaveLength(2);
      const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, warm.ids.sessionId, warm.ids.turnId);
      expect(budget).toMatchObject({ repairs: 0, modelDispatches: 2, logicalTools: 1 });
      expect(h.boundaries[start + 1]!.invoke - h.boundaries[start]!.invoke).toBe(1);
    }
    const start = h.boundaries.length;
    const later = await h.turn('Now read event abcde on my primary calendar.', [
      loadWire(['calendar_get_event'], 'later-load'),
      callWire('calendar_get_event', { calendarId: 'owned', eventId: 'abcde' }, 'later-get'),
      textWire('Read.')], first.ids.sessionId);
    expect(later.status).toBe('completed');
    expect(later.bodies).toHaveLength(3);
    expect(h.boundaries[start + 1]).toEqual(h.boundaries[start]);
    const last = later.bodies.at(-1)!;
    const loads = last.messages.filter(m => m.role === 'assistant'
      && m.tool_calls?.[0]?.function.name === 'activate_skill');
    expect(loads.map(m => m.tool_calls![0]!.id)).toEqual(['first-load', 'later-load']);
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual([
      'calendar_list_calendars', 'calendar_list_calendars', 'calendar_list_calendars', 'calendar_get_event']);
  } finally { await h.dispose(); }
});
```

Run: `npm test -- test/assembly/skill-workflow.spec.ts -t "two follow-ups"`. Expected: PASS; 3 + 2 + 2 + 3 model requests, not a forced activation per turn. The batch case has sequential operations but **one batched schema disclosure**, not parallel native calls; the stream contract still permits one native call per response.

- [ ] **Step 5: Verify and commit.** `npm test -- test/assembly/skill-workflow.spec.ts`

```powershell
git add backend/test/assembly/skill-workflow.spec.ts
git commit -m "test(skills): verify cold batch warm and later-tool call counts"
```

## Task 3: Assert the full assembled prefix, durable pairs, and reconstruction

**File:** Create `backend/test/assembly/skill-history.spec.ts`.

- [ ] **Step 1: Add this exact prefix/history regression.** This compares actual serialized message prefixes, not a synthetic expected system prompt. Freeze wall time without fake timers so ordinary same-date continuation is the tested condition; retain environment/date content for correctness.

```typescript
import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { skillLocalResultSchema } from '../../src/contracts/calendar-tools.js';
import { skillAssembly, loadWire, callWire, skillWire, textWire, USER,
  type NativeMessage } from './skill-fixture.js';

function assertPairs(messages: NativeMessage[]) {
  const ids: string[] = [];
  for (const [index, message] of messages.entries()) {
    for (const call of message.tool_calls ?? []) {
      expect(ids).not.toContain(call.id);
      ids.push(call.id);
      expect(messages[index + 1]).toMatchObject({ role: 'tool', tool_call_id: call.id });
      expect(messages.filter(m => m.role === 'tool' && m.tool_call_id === call.id)).toHaveLength(1);
    }
    if (message.role === 'tool') expect(messages[index - 1]?.tool_calls?.[0]?.id).toBe(message.tool_call_id);
  }
}

it('appends disclosures in position without rewriting any assembled prefix bytes', async () => {
  const date = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-04T12:00:00Z'));
  let h: Awaited<ReturnType<typeof skillAssembly>> | undefined;
  try {
    h = await skillAssembly({ realAssets: true });
    const raw = { plugin: 'google-calendar', tools: ['calendar_list_calendars'] };
    const cold = await h.turn('List my calendars.', [skillWire('activate_skill', raw, 'prefix-load', 'Loading schemas.'),
      callWire('calendar_list_calendars', {}, 'prefix-call'), textWire('Listed.')]);
    expect(cold.status).toBe('completed');
    const [initial, activated, executed] = cold.bodies;
    expect(initial!.tools!.map(t => t.function.name)).toEqual(['activate_skill', 'call_tool']);
    expect(JSON.stringify(activated!.messages.slice(0, initial!.messages.length)))
      .toBe(JSON.stringify(initial!.messages));
    expect(JSON.stringify(executed!.messages.slice(0, activated!.messages.length)))
      .toBe(JSON.stringify(activated!.messages));
    const call = activated!.messages.find(m => m.tool_calls?.[0]?.id === 'prefix-load')!;
    expect(call.content).toBe('Loading schemas.');
    expect(call.tool_calls![0]!.function).toEqual({ name: 'activate_skill', arguments: JSON.stringify(raw) });
    const result = activated!.messages.find(m => m.tool_call_id === 'prefix-load')!;
    expect(skillLocalResultSchema.parse(JSON.parse(result.content!))).toMatchObject({ kind: 'skill-disclosure' });
    const follow = await h.turn('List them again.', [callWire('calendar_list_calendars', {}, 'prefix-warm'),
      textWire('Listed again.')], cold.ids.sessionId);
    expect(follow.status).toBe('completed');
    expect(JSON.stringify(follow.bodies[0]!.messages.slice(0, executed!.messages.length)))
      .toBe(JSON.stringify(executed!.messages));
    expect(follow.bodies[0]!.messages.slice(executed!.messages.length))
      .toEqual([{ role: 'assistant', content: 'Listed.' }, { role: 'user', content: 'List them again.' }]);
    for (const body of [...cold.bodies, ...follow.bodies]) {
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(initial!.tools));
      assertPairs(body.messages);
    }
    expect(follow.bodies[0]!.messages.filter(m => m.content === 'List my calendars.')).toHaveLength(1);
    const beforeReopen = JSON.stringify(follow.bodies.at(-1)!.messages);
    await expect(h.service.operations.shutdown()).resolves.toEqual({ safe: true });
    const reopened = await AppService.create(h.bootstrap, h.f.ports);
    try {
      h.cal.modelWires.push(callWire('calendar_list_calendars', {}, 'reopened-call'), textWire('Reopened.'));
      const ids = await reopened.operations.runtime.submitTurn({ identity: { userId: USER,
        openRouterUser: USER, source: 'server-configured' }, sessionId: cold.ids.sessionId,
        content: 'List after reopening.', idempotencyKey: 'skill-reopen-0001' });
      const offset = h.bodies.length;
      await reopened.operations.runtime.executeTurn({ userId: USER, ...ids,
        signal: new AbortController().signal, emit: async () => {}, emitCalendar: async () => {} });
      const after = h.bodies.slice(offset);
      expect(after).toHaveLength(2);
      expect(JSON.stringify(after[0]!.messages.slice(0, follow.bodies.at(-1)!.messages.length)))
        .toBe(beforeReopen);
      assertPairs(after.at(-1)!.messages);
      expect(await h.cal.p.metadata.getAttempt(USER, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'completed' });
    } finally { await reopened.operations.shutdown(); }
  } finally { try { await h?.dispose(); } finally { date.mockRestore(); } }
});
```

- [ ] **Step 2: Run red/characterization.** `npm test -- test/assembly/skill-history.spec.ts -t "assembled prefix bytes"`

Expected old path: activation rejected and/or no native groups on follow-up. Expected after upstream: PASS. If full prefix comparison fails, return the first differing message index/role and safe content hashes to P2. Do not narrow the assertion to only `tools` or only system messages. If privacy expiry or a configuration/date change legitimately changes context, put it in a separate limitation case, not the ordinary continuation case.

- [ ] **Step 3: Minimal implementation:** only the `assertPairs` helper shown above. It intentionally checks no orphan/duplicate native pair and exact adjacency; do not write a history assembler in tests. Reopening creates a new AppService/runtime over the same saved stores **after** shutdown; it does not call `h.cal.restart()`, which would restart the fixture's different runtime rather than the assembled application.

- [ ] **Step 4: Append and run this deduplication/new-chat test.**

```typescript
it('acknowledges a retained disclosure and rejects execution in a fresh chat', async () => {
  const h = await skillAssembly();
  try {
    const a = await h.turn('Load calendar reading.', [loadWire(['calendar_list_calendars'], 'original-disclosure'),
      textWire('Ready.')]);
    const b = await h.turn('Load it again.', [loadWire(['calendar_list_calendars'], 'repeat-disclosure'),
      textWire('Still ready.')], a.ids.sessionId);
    const repeated = b.bodies.at(-1)!.messages.find(m => m.tool_call_id === 'repeat-disclosure')!;
    expect(JSON.parse(repeated.content!)).toMatchObject({ disclosures: [], alreadyLoaded: [
      { tool: 'calendar_list_calendars', disclosureCallId: 'original-disclosure' }] });
    expect(b.bodies.at(-1)!.messages.filter(m => m.tool_call_id === 'original-disclosure')).toHaveLength(1);
    const invokes = h.snapshot().invoke;
    const c = await h.turn('List calendars in a different chat.', [callWire('calendar_list_calendars', {}, 'fresh-rejected'),
      textWire('Schema is not loaded in this chat.')]);
    expect(c.bodies).toHaveLength(2);
    expect(h.snapshot().invoke).toBe(invokes);
    const rejected = c.bodies[1]!.messages.find(m => m.tool_call_id === 'fresh-rejected')!;
    expect(JSON.parse(rejected.content!)).toMatchObject({ code: 'SCHEMA_NOT_LOADED' });
    expect(JSON.stringify(c.bodies)).not.toContain('original-disclosure');
    expect(JSON.stringify(c.bodies)).not.toContain('repeat-disclosure');
    assertPairs(c.bodies[1]!.messages);
  } finally { await h.dispose(); }
});
```

Run: `npm test -- test/assembly/skill-history.spec.ts -t "fresh chat"`. Expected PASS and zero actions for the rejected call. Cross-user storage isolation, stale-revision refresh, missing disclosure/context-limit fail-closed behavior, and legacy decoding remain required P1/P2 focused gates; Task 8 records their actual commands/results rather than inventing a second integration registry or corrupting application data.

- [ ] **Step 5: Verify and commit.** `npm test -- test/assembly/skill-history.spec.ts test/assembly/skill-workflow.spec.ts`

```powershell
git add backend/test/assembly/skill-history.spec.ts
git commit -m "test(skills): preserve assembled prefix and durable native history"
```

## Task 4: Exercise automatic correction through the assembled loop

**File:** Modify `backend/test/assembly/skill-history.spec.ts`.

- [ ] **Step 1: Append this exact success regression.**

```typescript
it('repairs missing schema then executes once without an external discovery call', async () => {
  const h = await skillAssembly();
  try {
    const turn = await h.turn('List calendars.', [callWire('calendar_list_calendars', {}, 'missing-call'),
      loadWire(['calendar_list_calendars'], 'repair-load'),
      callWire('calendar_list_calendars', {}, 'repaired-call'), textWire('Listed.')]);
    expect(turn.status).toBe('completed');
    expect(turn.bodies).toHaveLength(4);
    expect(h.boundaries[1]).toEqual(h.boundaries[0]);
    expect(h.boundaries[2]).toEqual(h.boundaries[1]);
    const missing = turn.bodies[1]!.messages.find(m => m.tool_call_id === 'missing-call')!;
    expect(JSON.parse(missing.content!)).toMatchObject({ kind: 'skill-error',
      code: 'SCHEMA_NOT_LOADED', retry: 'activate-skill' });
    expect(h.spies.invoke.mock.calls.map(([input]) => input.call.name)).toEqual(['calendar_list_calendars']);
    expect(await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId))
      .toMatchObject({ repairs: 1, modelDispatches: 4, logicalTools: 1, creates: 0 });
    assertPairs(turn.bodies.at(-1)!.messages);
  } finally { await h.dispose(); }
});
```

- [ ] **Step 2: Run:** `npm test -- test/assembly/skill-history.spec.ts -t "repairs missing schema"`

Expected old path: stable calls fail. Expected integrated path: PASS; successful activation does not consume a repair cycle or reset repairs. No fixture-side injection of `SCHEMA_NOT_LOADED`: the runtime must generate it.

- [ ] **Step 3: Add the exact exhausted-budget regression.** This uses missing-schema plus argument failures to exercise the *shared* counter. The executor remains the argument authority; the bad calendar cursor cannot become a provider network request.

```typescript
it('does not reset the two-repair budget after a successful disclosure', async () => {
  const h = await skillAssembly();
  try {
    const turn = await h.turn('List calendars.', [callWire('calendar_list_calendars', {}, 'budget-missing'),
      loadWire(['calendar_list_calendars'], 'budget-load'),
      callWire('calendar_list_calendars', { pageToken: null }, 'budget-invalid-one'),
      callWire('calendar_list_calendars', { pageToken: null }, 'budget-invalid-two')]);
    expect(turn.status).toBe('failed');
    expect(turn.bodies).toHaveLength(4);
    expect(h.snapshot().external).toBe(0);
    expect(h.spies.oauth).not.toHaveBeenCalled();
    const budget = await h.cal.p.calendarAccountingV2.getBudget(USER, turn.ids.sessionId, turn.ids.turnId);
    expect(budget).toMatchObject({ repairs: 2, modelDispatches: 4, creates: 0 });
    expect(turn.frames.some(f => f.event.type === 'completed')).toBe(false);
    expect(turn.frames.some(f => f.event.type === 'error')).toBe(true);
    const last = turn.bodies.at(-1)!.messages;
    expect(last.some(m => m.role === 'tool' && m.content?.includes('ARGUMENTS_INVALID'))).toBe(true);
    assertPairs(last);
  } finally { await h.dispose(); }
});
```

- [ ] **Step 4: Run:** `npm test -- test/assembly/skill-history.spec.ts -t "two-repair budget"`. Expected explicit terminal failure, no fifth model request, no external calls. The existing stream contract uses an `error` event, not a nonexistent `failed` event; the actual attempt must also have a terminal failure status. Never catch and ignore arbitrary errors in `turn()` to make this test pass.
- [ ] **Step 5: Minimal implementation/verification:** Task 1 already supplies all observation needed. Route production correction defects to P2. Run `npm test -- test/assembly/skill-history.spec.ts`, then commit:

```powershell
git add backend/test/assembly/skill-history.spec.ts
git commit -m "test(skills): verify assembled load-retry and shared repair exhaustion"
```

## Task 5: Keep request estimates, unavailable usage, and task latency distinct

**Files:** Create `backend/test/assembly/skill-evidence.ts`; create `backend/test/performance/skill-evidence.spec.ts`. Append measurement emission to `skill-workflow.spec.ts` only after these pure checks pass.

- [ ] **Step 1: Add this exact failing measurement test.**

```typescript
import { expect, it } from 'vitest';
import { requestEvidence, taskEvidence, BASELINE } from '../assembly/skill-evidence.js';
import type { CapturedBody } from '../assembly/skill-fixture.js';

it('keeps byte reservations and missing live usage separate from measured fixture time', () => {
  const body: CapturedBody = { user: 'u', messages: [{ role: 'user', content: 'é' }], tools: [] };
  const record = requestEvidence(body);
  expect(record.bodyBytes).toBe(Buffer.byteLength(JSON.stringify(body), 'utf8'));
  expect(record.reservationUnits).toBe(64 + Buffer.byteLength(JSON.stringify({
    messages: body.messages, tools: body.tools }), 'utf8') + 32);
  const task = taskEvidence('ordinary', [body, body], 12.5);
  expect(task).toMatchObject({ scenario: 'ordinary', modelRequests: 2, fixtureTaskMs: 12.5,
    providerUsage: { inputTokens: null, outputTokens: null, cachedInputTokens: null,
      uncachedInputTokens: null }, providerLatencyMs: null });
  expect(task.reservationUnits).toBe(record.reservationUnits * 2);
  expect(task.bodyBytes).toBe(record.bodyBytes * 2);
  expect(BASELINE.sourceCommit).toBe('86dd3974d5e000ab05f4d2285879a723fcd3f69f');
  expect(BASELINE.nativeToolsBytes).toBe(2774);
  expect(BASELINE.matchedTaskLatencyMs).toBeNull();
});
```

- [ ] **Step 2: Run red:** `npm test -- test/performance/skill-evidence.spec.ts`. Expected missing-module/export failure.
- [ ] **Step 3: Implement only this test-local evidence projection.** No tokenizer, production estimator replacement, percentile framework, or legacy serializer. Baseline values are immutable observations from research §§5–6, not recalculated using the new code.

```typescript
import type { CapturedBody } from './skill-fixture.js';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const BASELINE = {
  sourceCommit: '86dd3974d5e000ab05f4d2285879a723fcd3f69f', applicationCommit: '118ba21',
  nativeToolsBytes: 2774,
  nativeToolsSha256: 'fbed2721e65f33b5a890d1bd77ee17fb2ccd5a5cae5e5f16b410db87d844f8f8',
  fixedPrefixBytes: 9680,
  fixedPrefixSha256: 'fffdb37fc8709f79cc2e87b8e29e9ba29a05ce1aac65558ed220fe3df0be14ea',
  coldBodies: [12884, 12886, 12919, 12892, 12894],
  coldReservationUnits: [12743, 12745, 12778, 12751, 12753],
  observedCorrectionRequests: 3, observedPaginationRequests: 3,
  matchedTaskLatencyMs: null,
} as const;
export function requestEvidence(body: CapturedBody) {
  return { bodyBytes: bytes(body), messageBytes: bytes(body.messages),
    toolsBytes: bytes(body.tools ?? []),
    reservationUnits: 64 + bytes({ messages: body.messages, tools: body.tools ?? [] })
      + 32 * body.messages.length };
}
export function taskEvidence(scenario: string, bodies: CapturedBody[], fixtureTaskMs: number) {
  const requests = bodies.map(requestEvidence);
  return { scenario, modelRequests: bodies.length, requests,
    bodyBytes: requests.reduce((n, r) => n + r.bodyBytes, 0),
    reservationUnits: requests.reduce((n, r) => n + r.reservationUnits, 0),
    fixtureTaskMs, providerLatencyMs: null,
    providerUsage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, uncachedInputTokens: null } };
}
```

This projection deliberately handles wires with **no usage frames**; do not use it to overwrite real reported usage if authorized provider runs are added later. Existing accounting/benchmark usage tests continue to verify numeric/cached fields. They are parser evidence, not provider-cache evidence. `reservationUnits` is the conservative byte-based reservation unit, **not a token count**.

- [ ] **Step 4: Add the exact matched baseline cold-probe test.** Add production imports shown here. It uses the current serializer and real assets, fixed research environment, exact output cap and inputs; no old runtime is checked out or kept alive.

```typescript
import { createHash } from 'node:crypto';
import { SKILL_NATIVE_TOOLS, compactSkillCatalog } from '../../src/contracts/calendar-tools.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { providerParameters } from '../../src/model/policy.js';
import { loadFixedAssets } from '../../src/instructions/fixed-assets.js';
import { fixedContextMessages, environmentContextMessage, responseModeMessage }
  from '../../src/context/context-budget.js';

it('compares equivalent cold probes with the recorded five-schema baseline', async () => {
  const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
  const assets = await loadFixedAssets({ instructions: 'src/instructions/system.md', knowledge: '../product_knowledge.md' });
  const prefix = [...fixedContextMessages(assets), environmentContextMessage({ timeZone: 'Etc/UTC',
    currentDate: '2026-11-04', dayOfWeek: 'Wednesday' }), responseModeMessage('text')];
  const tools = SKILL_NATIVE_TOOLS.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.inputSchema } }));
  const hash = createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
  const comparablePrefix = hash === BASELINE.fixedPrefixSha256;
  const rows = ['What is 2 + 2?', 'Read event abcde',
    'List my calendars and check availability tomorrow', 'Read event abcde again', 'Now find events tomorrow']
    .map((content, index) => {
      const body = { ...providerParameters(config, { user: 'aurvin-dev-user', maxOutputTokens: 256 }),
        messages: [...prefix, { role: 'user', content }], tools, stream: true,
        stream_options: { include_usage: true } };
      return { input: content, comparablePrefix, baselineBodyBytes: BASELINE.coldBodies[index],
        current: requestEvidence(body as CapturedBody) };
    });
  expect(rows).toHaveLength(5);
  expect(tools.map(t => t.function.name)).toEqual(['activate_skill', 'call_tool']);
  expect(JSON.stringify(compactSkillCatalog())).not.toMatch(/inputSchema|additionalProperties/);
  console.log('SKILL_COLD_PROBES', JSON.stringify({ hash, comparablePrefix,
    note: 'Serializer probes exclude runtime catalog insertion; not matched multi-turn tasks.', rows }));
});
```

Do not assert a fabricated savings percentage. P2 legitimately changes system instructions: a changed asset/prefix hash must label total-body deltas **not like-for-like**, while the independently recorded tools-array byte comparison remains valid. Runtime catalog bytes are included in actual task requests, not silently omitted from claimed task savings. These cold probes mirror the research construction and explicitly exclude runtime catalog insertion.

- [ ] **Step 5: Emit actual matched task evidence in each completed workflow case.** Import `taskEvidence` into `skill-workflow.spec.ts`; after checking status/count/budget in each row and each warm/later turn, add exactly:

```typescript
console.log('SKILL_TASK', JSON.stringify({ ...taskEvidence(row.name, turn.bodies, turn.fixtureTaskMs), calls,
  success: turn.status === 'completed', repairs: budget?.repairs,
  boundaryBeforeDiscovery: h.boundaries[0], boundaryAfterDiscovery: h.boundaries[1],
  finalBoundary: h.snapshot() }));
```

For the ordinary test use `taskEvidence('ordinary', turn.bodies, turn.fixtureTaskMs)` and `success`, without nonexistent `row`/`budget`. For the follow-up test, put the same expression using `taskEvidence('warm-follow-up', warm.bodies, warm.fixtureTaskMs)` inside the loop, and `taskEvidence('later-new-tool', later.bodies, later.fixtureTaskMs)` after `later`. Emit `h.snapshot()` before/after the individual turn so task-level external/preflight counts are differences, not misleading cumulative totals. Add the following local bindings around the existing turn call **before** the `SKILL_TASK` emission above, which consumes `calls`:

```typescript
const beforeTask = h.snapshot();
// Existing awaited h.turn(...) call remains between these two bindings.
const afterTask = h.snapshot();
const calls = Object.fromEntries(Object.keys(beforeTask).map(key => {
  const k = key as keyof typeof beforeTask;
  return [k, afterTask[k] - beforeTask[k]];
}));
```

Report complete scenario sequences as sums of their actual request rows; do not compare a current four-turn total with a baseline cold “again” wording probe. Correct selection is asserted via real executor invocations. Count argument corrections from the actual budget and distinguish requested operations from successful outcomes.

- [ ] **Step 6: Verify and commit.**

Run `npm test -- test/performance/skill-evidence.spec.ts test/assembly/skill-workflow.spec.ts`. Expected PASS plus `SKILL_COLD_PROBES` and `SKILL_TASK` records. Missing provider/cache fields remain `null`; no claimed live provider latency/cost improvement.

```powershell
git add backend/test/assembly/skill-evidence.ts backend/test/performance/skill-evidence.spec.ts backend/test/assembly/skill-workflow.spec.ts
git commit -m "test(skills): record matched task counts and honest size evidence"
```

## Task 6: Migrate existing assembled consumer assertions, not a legacy router

**Files:** Necessary existing P3-owned assembly suites listed in the file map; no production edits.

- [ ] **Step 1: Expose stale consumers with existing tests.**

Run: `npm run build`, then `npm test -- test/assembly/ test/integration/plugins/multi-calendar/ test/benchmark/ test/voice/ test/performance/calendar-critical-path.spec.ts test/performance/durable-latency.spec.ts`.

Expected failure examples already visible in the planning checkout: `calendar-capability.spec.ts:238–242` expects five native names; built assembly sends the old native name; `calendar-simplification.built.spec.ts:60` calls public paging without a query. Record exact failures, distinguishing pre-existing ones in research §5. Do not claim all failures have the same cause.

- [ ] **Step 2: Change the capability assertion to exactly:**

```typescript
expect((started.cal.modelBodies[0]!.tools as Array<{ function: { name: string } }>).map(
  tool => tool.function.name)).toEqual(['activate_skill', 'call_tool']);
```

Keep the existing disconnected/unconfigured/model-ineligible assertions (`tools` absent); generic tools must not leak into ordinary disabled text. Verify: `npm test -- test/assembly/calendar-capability.spec.ts`.

- [ ] **Step 3: Migrate one owned cold script at a time with explicit discovery.** Do not globally prepend activation in `assembledCalendarApp`: that would conceal cold/warm defects and change ordinary text requests. Replace a helper that emits old native operation names with this local wire helper, only in a suite that owns it:

```typescript
function toolWire(name: string, raw = '{}', id = 'call-contract'): string {
  return callWire(name, JSON.parse(raw), id);
}
```

For example, in `calendar-simplification.spec.ts` the invalid-arguments case becomes exactly:

```typescript
h.cal.modelWires.push(loadWire(['calendar_list_calendars'], 'contract-load'),
  toolWire('calendar_list_calendars', '{"pageToken":null}', 'contract-invalid'),
  toolWire('calendar_list_calendars', '{}', 'contract-corrected'), textWire('Fixture-qualified answer.'));
```

Expect four requests and dispatch reasons `['initial','continuation','schema-repair','continuation']`; expect matched local error and disclosure tool results rather than the previous adapter-only repair suffix. Expected native definitions derive from `SKILL_NATIVE_TOOLS`, not `CALENDAR_TOOLS`. Keep `CALENDAR_TOOLS` for actual operation names/results. In the pagination response generator use one new first activation response; shift original page-one/page-two/text cases to dispatch 2/3/4 and ignore the disclosure when collecting calendar-result pages:

```typescript
if (result) {
  const value = JSON.parse(result.content);
  if (Array.isArray(value.calendars)) pages.push(value);
}
```

Assert four requests, two logical operations, zero repairs, both pages and no Google calls with retained resource metadata. Do not mistake schema activation for a pagination page. Verify each block with its existing exact `-t` name before proceeding.

- [ ] **Step 4: Migrate the emitted-code regression explicitly.** In `calendar-simplification.built.spec.ts` compare compiled `SKILL_NATIVE_TOOLS` with source `SKILL_NATIVE_TOOLS`; keep compiled executor-instance, terminal/cursor/privacy assertions. Its wire list becomes:

```typescript
h.cal.modelWires.push(loadWire(['calendar_list_calendars'], 'built-load'),
  callWire('calendar_list_calendars', { pageToken: 'first' }, 'built-bad-cursor'),
  callWire('calendar_list_calendars', {}, 'built-corrected'),
  textWire('Your primary calendar is identified; manager access alone does not prove secondary data ownership.'));
```

Use four requests and the same four dispatch reasons as Step 3. The stale paging call becomes exactly:

```typescript
const stored = await h.cal.p.messages.list('aurvin-dev-user', ids.sessionId, { cursor: null, limit: 20 });
```

Never remove pagination validation from the repository. Verify after build: `npm test -- test/assembly/calendar-simplification.built.spec.ts`.

- [ ] **Step 5: Preserve create/HTTP/observability semantics when migrating their scripts.** For each *cold* create in `calendar-flow.spec.ts` and `calendar-multi-flow.spec.ts`, explicitly insert `loadWire(['calendar_create_event'], '<unique-id>')` before `callWire('calendar_create_event', event(), '<unique-id>')`; do not insert it into a saved confirmation response. Existing implicit availability safety checks remain executor-owned and need no model-request schema ceremony. Retain uncertainty/no-double-create/receipt/reader-denial assertions. For the existing malformed stream use the native name `call_tool` with the same intentionally incomplete raw JSON, then a successful activation and corrected call; do not run malformed raw text through `JSON.parse` in a fixture helper. The byte-invalid case must still reach the production scanner.

In `calendar-observability.spec.ts`, use the Step 3 wrapper for the existing locally defined valid-wire helper, prepend explicit activation to cold scripts, and retain payload redaction, IDs, cursor errors, provider attribution, terminal/accounting assertions. Expected extra request counts must equal the explicitly added activation only. Underlying canonical `tool-execution` labels must remain Calendar operation names; raw native decisions use the upstream stable discriminator. Do not guess a diagnostics field name: check P1/P2's committed diagnostic tests before changing that assertion.

Run each affected exact file separately. If an upstream fixture helper already migrated a script, do not double-wrap it or add another activation. A shared `createWire` change in P2 may cover call wrapping, but never infer loaded state from it. Full stale-script migrations are test maintenance, not production changes; stage the actual named files only.

- [ ] **Step 6: Verify and commit only the successful migrations.**

Run: `npm test -- test/assembly/ test/integration/plugins/multi-calendar/ test/benchmark/ test/voice/`. Run `npm test -- test/performance/calendar-critical-path.spec.ts test/performance/durable-latency.spec.ts` separately so performance failures are visible. Never increase wave/read thresholds just to get green: measure the extra local history writes/reads, classify expected protocol overhead versus a production regression, and return the latter to P2. A remaining failure blocks the affected gate and is recorded; it is not a silent accepted baseline.

Commit message: `test(skills): migrate assembled consumers to stable discovery protocol`.

Stage only the exact modified files from this task, with explicit `git add <named-paths>`; no directory-wide add. If no migration is needed after upstream handoff, record the executed checks and omit an empty commit.

## Task 7: Measure synthetic catalog shape and the existing whole-runtime latency path

### 7A. Synthetic scale, not synthetic integrations

**File:** Create `backend/test/performance/skill-scale.spec.ts`.

- [ ] **Step 1: Add the exact regression.**

```typescript
import { expect, it } from 'vitest';
import { compactSkillCatalog, SKILL_NATIVE_TOOLS, selectSkillTools }
  from '../../src/contracts/calendar-tools.js';

it.each([5, 50, 250])('measures %s synthetic tool schemas without registering a plugin', count => {
  const tools = Array.from({ length: count }, (_, index) => ({
    name: `synthetic_${String(index).padStart(3, '0')}`, description: `Read synthetic item ${index}.`,
    revision: 'synthetic.v1', inputSchema: { type: 'object', additionalProperties: false,
      required: ['itemId'], properties: { itemId: { type: 'string', description: 'x'.repeat(512) } } },
  }));
  const catalog = compactSkillCatalog(tools);
  const selected = selectSkillTools({ plugin: 'google-calendar', tools: [tools[0]!.name] }, tools);
  expect(selected).toEqual({ ok: true, tools: [tools[0]] });
  if (!selected.ok) throw new Error(`Unexpected synthetic selection: ${selected.code}`);
  expect(compactSkillCatalog([...tools].reverse())).toEqual(catalog);
  expect(JSON.stringify(catalog)).not.toContain('inputSchema');
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
  const record = { count, catalogBytes: bytes(catalog), allSchemaBytes: bytes(tools),
    selectedSchemaBytes: bytes(selected.tools), nativeBytes: bytes(SKILL_NATIVE_TOOLS),
    integrationsAdded: 0, providerUsage: null, providerLatencyMs: null };
  expect(record.catalogBytes).toBeLessThan(record.allSchemaBytes);
  expect(SKILL_NATIVE_TOOLS.map(t => t.name)).toEqual(['activate_skill', 'call_tool']);
  console.log('SKILL_SCALE', JSON.stringify(record));
});
```

- [ ] **Step 2: Run:** `npm test -- test/performance/skill-scale.spec.ts`. Expected PASS after P1; old contract fails missing exports. P1's committed plan returns `{ok:true,tools}` or `{ok:false,code}`, not a serialized disclosure. Reconcile any changed exported contract rather than wrapping it with a new selection implementation.
- [ ] **Step 3: Minimal implementation:** the inline synthetic metadata generator above. No fake executor, plugin registration, production registry injection, schema copying into `src`, or claim that 250-tool chats were admitted. All-tool runtime result/context ceiling tests belong to P2 and must still pass; larger synthetic shape measurements do not waive them.
- [ ] **Step 4: Commit:** `test(skills): measure synthetic catalog scaling without integrations` (stage only `backend/test/performance/skill-scale.spec.ts`).

### 7B. Stock saver and modeled storage latency

**File:** Create `backend/test/performance/skill-latency.spec.ts`.

- [ ] **Step 1: Add this exact whole-runtime regression.**

```typescript
import { expect, it } from 'vitest';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { loadWire, callWire, textWire } from '../assembly/skill-fixture.js';

it('records cold and warm task latency through stock repositories and saver', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  try {
    fx.calendar!.modelWires.push(loadWire(['calendar_list_calendars'], 'latency-load'),
      callWire('calendar_list_calendars', {}, 'latency-cold'), textWire('Listed.'));
    const cold = await fx.measure(async () => {
      const ids = await fx.submit('List calendars.');
      await fx.execute(ids);
      return ids;
    });
    expect(fx.modelCalls).toHaveLength(3);
    const offset = fx.modelCalls.length;
    fx.calendar!.modelWires.push(callWire('calendar_list_calendars', {}, 'latency-warm'), textWire('Listed again.'));
    const warm = await fx.measure(async () => {
      const ids = await fx.submit('List them again.', cold.result.sessionId);
      await fx.execute(ids);
      return ids;
    });
    expect(fx.modelCalls.length - offset).toBe(2);
    for (const row of [cold, warm]) {
      expect(await fx.run(() => fx.persistence.metadata.getAttempt(fx.identity.userId,
        row.result.sessionId, row.result.attemptId))).toMatchObject({ status: 'completed' });
      expect(row.metrics.wireFailed).toBe(0);
      expect(row.metrics.saverWrites).toBeGreaterThan(0);
      expect(row.metrics.elapsedMs).toBeGreaterThan(0);
    }
    expect(fx.googleEffects).toHaveLength(0);
    console.log('SKILL_STORAGE_LATENCY', JSON.stringify({ assumptions: { readMs: 67, writeMs: 449,
      modelDelayMs: 0, pluginDelayMs: 0 }, cold: cold.metrics, warm: warm.metrics,
      providerLatencyMs: null, nativeMongoLatencyMs: null }));
  } finally { await fx.close(); }
});
```

- [ ] **Step 2: Run:** `npm test -- test/performance/skill-latency.spec.ts`. Expected PASS after P2; no native database required. If P2's latency fixture uses a different key than the existing `calendar` return property, reconcile the fixture handoff before editing, not by constructing a second runtime.
- [ ] **Step 3: Minimal implementation:** reuse `createLatencyFixture` and `DependencyProbe` exactly. Do not add sleeps, fake provider latency, a production timing wrapper, or a new benchmark command. Wall task duration comes from Task 5; this test reports modeled storage critical-path time with explicit assumptions. Do not compare its elapsed milliseconds with suite duration or the research cold-size probes, and do not require warm latency to be lower when longer retained history genuinely costs more.
- [ ] **Step 4: Verify:** `npm test -- test/performance/skill-latency.spec.ts test/performance/confirmed-state-cache.spec.ts test/performance/admission-context-reuse.spec.ts test/benchmark/latency.spec.ts`.
- [ ] **Step 5: Commit:** `test(skills): measure cold and warm stock-saver critical paths` (stage only `backend/test/performance/skill-latency.spec.ts`).

## Task 8: Optional native persistence, compatibility, and the evidence handoff

### 8A. Native restart check, guarded independently

**File:** Create `backend/test/integration/skill-restart.native.e2e-spec.ts`.

- [ ] **Step 1: Add this exact test.** It uses only the operator-supplied isolated test fixture, not application configuration. Do not set a URI, provision a service, print a URI, or borrow production data.

```typescript
import { describe, expect, it } from 'vitest';
import { nativeCalendarFixture } from '../runtime/calendar-multi-fixture.js';
import { loadWire, callWire, textWire } from '../assembly/skill-fixture.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('isolated native skill restart', () => {
  it('reuses durable schema disclosures after stopping the executor', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.modelWires.push(loadWire(['calendar_list_calendars'], 'native-disclosure'),
        callWire('calendar_list_calendars', {}, 'native-cold'), textWire('Listed.'));
      const cold = await h.submit('List calendars.');
      await h.execute(cold);
      await h.restartStoppedExecutor();
      h.modelWires.push(callWire('calendar_list_calendars', {}, 'native-warm'), textWire('Listed again.'));
      const warm = await h.submit('List calendars again.', cold.sessionId);
      await h.execute(warm);
      expect(await h.budgetFor(warm)).toMatchObject({ modelDispatches: 2, repairs: 0, logicalTools: 1 });
      expect(h.modelWires).toHaveLength(0);
      expect(h.effects).toHaveLength(0);
      expect(await h.runtime.getTurnStatus(h.identity.userId, warm.sessionId, warm.turnId))
        .toMatchObject({ status: 'completed' });
    } finally { await h.dispose(); }
  }, 60000);
});
```

- [ ] **Step 2: Verify with explicit suite selection:** `npm run test:e2e -- test/integration/skill-restart.native.e2e-spec.ts`.

Expected absent prerequisites: one skipped test, **not a pass**. With prerequisites: test executes against generated native databases and passes only on admitted topology. Existing `nativeCalendarFixture` must accept the `sessionId` argument, as its `CalendarDisclosureFixture` contract specifies; if the actual committed fixture does not expose it, route fixture adaptation to P2 rather than cast away the argument. Preserve all additional native safety authorization guards in any existing suite you run; do not turn them on implicitly.

- [ ] **Step 3: Commit:** `test(skills): verify isolated native disclosure restart` (stage only `backend/test/integration/skill-restart.native.e2e-spec.ts`).

### 8B. Run consumer and evidence gates without inventing compatibility claims

- [ ] **Step 1: Run P3's focused suite and retain actual output.**

```powershell
npm test -- test/assembly/skill-workflow.spec.ts test/assembly/skill-history.spec.ts test/performance/skill-evidence.spec.ts test/performance/skill-scale.spec.ts test/performance/skill-latency.spec.ts
```

Expected PASS of every discovered deterministic test. Record exact test/file pass/fail/skip counts and emitted `SKILL_*` rows. A zero-test run is a configuration failure, not evidence. Log paths belong under `C:/Users/Peter/AppData/Local/Temp/opencode/`; never commit raw logs, credentials, user payloads, or dependencies.

- [ ] **Step 2: Exercise existing compatibility/safety gates.**

```powershell
npm test -- test/contracts/skill-protocol.spec.ts test/model/ test/context/ test/runtime/ test/persistence/ test/plugins/ test/assembly/ test/integration/plugins/multi-calendar/ test/performance/confirmed-state-cache.spec.ts test/benchmark/ test/voice/ test/http/voice-exclusion.spec.ts
```

P1/P2 must report actual tests for stale refresh, invalid/oversized selection, no partial disclosure, cross-user isolation, missing/corrupt/over-budget retained history, confirmation, idempotency, cancellation, uncertain-write recovery, completion barriers, and version-1/2 record decoding. Require their concrete file/test names and results in the handoff; do not infer coverage from directory presence. Run those named tests if the broad command did not execute them. Do not add/read Azure credentials or run the service compatibility suites; Azure/provider certification remains outside authorization.

For internal voice isolation, run existing `test/http/voice-exclusion.spec.ts`, `test/runtime/voice-*.spec.ts`, and `test/voice/` checks. Note that existing native multi-mode tests may skip and may not enable Calendar. If no committed P2 runnable regression proves an internally submitted live turn bypasses enabled Calendar even with retained disclosures, report that exact coverage gap to P2; do not declare “voice compatible” based on a text-only fixture. No new voice integration or tool exposure belongs in P3.

- [ ] **Step 3: Record environment and the tested commit set.**

Run separately: `node --version`, `npm --version`, `git rev-parse HEAD`, `git log --oneline 118ba21..HEAD`, `git status --short`. Record only presence/absence of native prerequisites; never print their values. Preserve baseline status: authoritative research run had **2502 passed / 60 failed / 10 skipped**, and 609 focused protocol/assembly/cache checks passed. Existing failures still block final all-green completion until corrected or explicitly resolved through ownership; “pre-existing” is not a passing result.

- [ ] **Step 4: Write `docs/plugin-skill-scalability/verification.md` with these exact sections and actual measured content.** This is an evidence document, not a promised-results template.

```markdown
# Plugin skill scalability — verification evidence

## Scope and tested revisions
## Environment and prerequisite admission
## Executed commands and pass/fail/skip counts
## Matched assembled scenarios and correctness
## Discovery, execution, model, OAuth, and preflight call counts
## Assembled prefix, ordered history, and reconstruction
## Recorded baseline and like-for-like comparison limits
## Serialized bytes and conservative reservation units
## Task-level fixture timings and modeled storage latency
## Synthetic catalog scaling
## Compatibility and existing safety regressions
## Unavailable provider/cache/service evidence
## Failures, owner-routed corrections, and rerun evidence
## Final-verification handoff
```

Populate scenario rows for ordinary question; single cold operation; batched multi-tool task; all-tool disclosure; two warm follow-ups; later newly needed tool; correction and repair exhaustion. Include selected canonical tools, success/failure, request count, discovery count, actual external deliveries, OAuth/preflight count, repairs, cumulative request bytes/reservation units, and fixture task time. Show actual per-turn counts rather than count historical tool messages as new actions. Preserve the entire matched scenario sequence when summing totals.

Write these limitations explicitly:

- Provider-reported total input/output/uncached/cached tokens and live provider latency/cost are **unavailable**, not zero. Schema context remains present on warm requests. Usage parser fixtures do not establish provider cache hits.
- Research recorded cold request-shape probes and two specific three-request correction/pagination flows, not matched five-scenario task latency. Compare only those measured equivalents; baseline task latency stays unavailable. Do not run the old routing path in production or add a legacy implementation for comparison.
- New cold serializer probes exclude runtime catalog insertion; actual assembled task measurements include it. If base instructions changed, record both prefix hashes and decline like-for-like total-body claims.
- Prefix stability applies to ordinary same-date/same-mode/configuration/permission continuation. Date/permission/privacy/asset changes can legitimately invalidate prefixes and must not be “fixed” by removing correctness checks.
- Real wall fixture task time, modeled storage delay, suite duration, native database timing, and live provider latency are different quantities. Synthetic catalog measurements do not prove admitted execution/context at those sizes.
- Native checks without prerequisites are skipped. Do not claim replica-set, Azure, Google, or OpenRouter certification from fake stores/providers.
- Code review is **SKIPPED**. P3 passing does not close V: the orchestrator still owns the full backend/frontend build/lint/test and backend e2e gate, actual final tested revision set, and `final_report.md`.

- [ ] **Step 5: Check document/link consistency and commit evidence.** Verify referenced files exist, evidence rows match retained output, no test count treats skips as passes, and no production implementation was changed by P3. Run `git diff --check`, then:

```powershell
git add docs/plugin-skill-scalability/verification.md
git commit -m "docs(skills): record assembled workflow size and latency evidence"
```

## Completion handoff to the orchestrator

Return owned paths and commit hashes; exact focused/full commands and executed pass/fail/skip counts; scenario call-count outcomes; baseline comparability/measurement limitations; native prerequisite status; any P1/P2 defects with corrected commits and reruns; and `verification.md` path. Do not mark the workflow complete, edit state, dispatch a reviewer, or write the final report. V must run, from their packages, backend `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`; frontend `npm run build`, `npm run lint`, `npm test`; and repository `git diff --check`. Existing failed gates must be resolved by their owners, not hidden behind the skipped code-review phase.

## Planning validation and provenance

- This is a plan, not executed application or performance evidence. At planning time, the 23 fenced TypeScript snippets passed TypeScript syntax transpilation; required plan headings and local Markdown links were checked, and `git diff --check` passed. No application, native, paid-provider, or latency check was run for this documentation-only assignment.
- Source tracing confirmed `CalendarDiscoveryService`, `createLatencyFixture`'s `calendar` return property, the native fixture's session-aware `submit` signature, and the `error` stream event. P1's selection handoff returns a discriminated `{ok, tools/code}` result. Keep these signatures consistent when reconciling prerequisite worker commits.
- The initial plan was captured by the concurrent P1 commit `0b7b23fe3a12a4889fab81ee114bfa8de6bb41e6`. Preserve that commit and its unrelated application work; the documentation-only follow-up carries the requested P3 planning commit message. This provenance does not satisfy P1/P2 worker completion or authorize P3 execution.
