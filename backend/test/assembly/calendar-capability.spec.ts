import { expect, it, vi } from 'vitest';
import { GoogleCalendarConnections } from '../../src/plugins/google-calendar/connection.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';
import { prepareConfigurationSnapshot, type AssemblyPorts } from '../../src/app.service.js';
import { loadModelLimits } from '../../src/model/index.js';
import { calendarEvidenceFor } from '../../src/model/calendar-evidence.js';
import type { CalendarCatalogueEvidence } from '../../src/model/catalogue.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { fixturePricing } from '../model/calendar-fixtures.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { assembledCalendarApp } from './calendar-fixture.js';

const MODEL = 'fixture/model';
const USER = 'aurvin-dev-user';

// The frozen evidence Aurvin would hold for a Calendar-capable model.
const frozenEvidence: CalendarCatalogueEvidence = {
  pricing: fixturePricing,
  nativeStrict: false,
  parallelToolCallsParameter: false,
};

function catalogueEntry(overrides: { prompt?: string; completion?: string; tools?: boolean } = {}) {
  return {
    id: MODEL,
    context_length: 32768,
    top_provider: { max_completion_tokens: 4096 },
    supported_parameters: ['max_tokens', ...(overrides.tools === false ? [] : ['tools'])],
    pricing: {
      prompt: overrides.prompt ?? '0.000001',
      completion: overrides.completion ?? '0.000002',
    },
  };
}

function catalogueFetcher(entry: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [entry] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
}

async function prepared(options: {
  evidence: CalendarCatalogueEvidence | null;
  entry?: Record<string, unknown>;
}) {
  const f = assemblyFixture();
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = MODEL;
  const catalogue = catalogueFetcher(options.entry ?? catalogueEntry());
  const seen: Array<CalendarCatalogueEvidence | undefined> = [];
  const loader: typeof loadModelLimits = async (c, outer, _fetcher, evidence) => {
    seen.push(evidence);
    return loadModelLimits(c, outer, catalogue, evidence);
  };
  const snapshot = await prepareConfigurationSnapshot(
    f.bootstrap,
    { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
    f.assets,
    loader,
    catalogue,
    new AbortController().signal,
    () => options.evidence,
  );
  return { snapshot, seen };
}

const catalogueLimits: AssemblyPorts['limits'] = (c, outer, _fetcher, evidence) =>
  loadModelLimits(c, outer, catalogueFetcher(catalogueEntry()), evidence);
const textOnlyLimits: AssemblyPorts['limits'] = (c, outer, _fetcher, evidence) =>
  loadModelLimits(c, outer, catalogueFetcher(catalogueEntry({ tools: false })), evidence);

it('publishes the verified Calendar capability when the frozen evidence matches the catalogue', async () => {
  const { snapshot, seen } = await prepared({ evidence: frozenEvidence });
  expect(seen).toEqual([frozenEvidence]);
  expect(snapshot.modelLimits?.calendar).toEqual({
    tools: true,
    nativeStrict: false,
    parallelToolCallsParameter: false,
    pricing: fixturePricing,
  });
  expect(snapshot.modelLimits?.modelId).toBe(MODEL);
});

it('publishes the verified Calendar capability for the frozen production model', async () => {
  const evidence = calendarEvidenceFor('openai/gpt-6-luna');
  expect(evidence).not.toBeNull();
  const f = assemblyFixture();
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'openai/gpt-6-luna';
  const catalogue = catalogueFetcher({
    id: 'openai/gpt-6-luna',
    context_length: 1050000,
    top_provider: { max_completion_tokens: 128000 },
    supported_parameters: ['max_tokens', 'tools', 'structured_outputs'],
    pricing: {
      prompt: evidence!.pricing.promptUsdPerToken,
      completion: evidence!.pricing.completionUsdPerToken,
    },
  });
  // No evidence override: the production frozen table is the only source.
  const snapshot = await prepareConfigurationSnapshot(
    f.bootstrap,
    { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
    f.assets,
    loadModelLimits,
    catalogue,
    new AbortController().signal,
  );
  expect(snapshot.modelLimits?.calendar).toMatchObject({
    tools: true,
    nativeStrict: false,
    parallelToolCallsParameter: false,
    pricing: evidence!.pricing,
  });
});

it('admits Calendar for a config-page model that is not in the frozen table', async () => {
  const f = assemblyFixture();
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'anthropic/claude-haiku-5.5';
  const catalogue = catalogueFetcher({
    id: 'anthropic/claude-haiku-5.5',
    context_length: 32768,
    top_provider: { max_completion_tokens: 4096 },
    supported_parameters: ['max_tokens', 'tools'],
    pricing: { prompt: '0.000001', completion: '0.000005' },
  });
  const snapshot = await prepareConfigurationSnapshot(
    f.bootstrap,
    { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
    f.assets,
    loadModelLimits,
    catalogue,
    new AbortController().signal,
  );
  expect(snapshot.modelLimits?.calendar).toMatchObject({
    tools: true,
    nativeStrict: false,
    parallelToolCallsParameter: false,
    pricing: {
      modelId: 'anthropic/claude-haiku-5.5',
      promptUsdPerToken: '0.000001',
      completionUsdPerToken: '0.000005',
      requestUsd: '0',
      providerRoute: 'openrouter-default/anthropic',
    },
  });
});

it('keeps ordinary text chat when the catalogue does not advertise tools', async () => {
  const { snapshot, seen } = await prepared({ evidence: null, entry: catalogueEntry({ tools: false }) });
  expect(seen).toEqual([undefined]);
  expect(snapshot.modelLimits?.calendar).toBeUndefined();
  expect(snapshot.modelLimits).toMatchObject({
    modelId: MODEL, contextTokens: 32768, outputTokens: 4096,
    supportsMaxTokens: true, source: 'catalogue',
  });
  expect(snapshot.openRouter.apiKey).toBe('fixture-key');
});

it('disables the plugin when the catalogue price no longer matches the frozen evidence', async () => {
  const { snapshot } = await prepared({
    evidence: frozenEvidence,
    entry: catalogueEntry({ prompt: '0.000009' }),
  });
  expect(snapshot.modelLimits?.calendar).toBeUndefined();
  expect(snapshot.modelLimits?.modelId).toBe(MODEL);
});

it('disables the plugin when the catalogue no longer advertises native tools', async () => {
  const { snapshot } = await prepared({
    evidence: frozenEvidence,
    entry: catalogueEntry({ tools: false }),
  });
  expect(snapshot.modelLimits?.calendar).toBeUndefined();
  expect(snapshot.modelLimits?.modelId).toBe(MODEL);
});

it('enables the Calendar plugin only with a capable model and an enabled plugin', async () => {
  const capable = await assembledCalendarApp({
    limits: catalogueLimits,
    calendarEvidence: () => frozenEvidence,
  });
  try {
    const ready = await capable.service.operations.readiness.read();
    expect(ready.calendar?.enabled).toBe(true);
  } finally {
    await capable.dispose();
  }

  const incapable = await assembledCalendarApp({
    limits: textOnlyLimits,
    calendarEvidence: () => null,
  });
  try {
    const ready = await incapable.service.operations.readiness.read();
    expect(ready.calendar?.enabled).toBe(false);
  } finally {
    await incapable.dispose();
  }

  const unconfigured = await assembledCalendarApp({
    limits: catalogueLimits,
    calendarEvidence: () => frozenEvidence,
    configured: false,
  });
  try {
    const ready = await unconfigured.service.operations.readiness.read();
    expect(ready.calendar?.enabled).toBe(false);
  } finally {
    await unconfigured.dispose();
  }
});

it('advertises the Calendar tool schemas to a capable model with a connected account', async () => {
  const started = await assembledCalendarApp({
    limits: catalogueLimits,
    calendarEvidence: () => frozenEvidence,
  });
  try {
    await started.service.calendarFor(USER).connections.statusV2();
    started.cal.modelWires.push(textWire('Done.'));
    const submitted = await started.service.operations.runtime.submitTurn({
      identity: { userId: USER, openRouterUser: USER, source: 'authenticated-session' },
      sessionId: null, content: 'List my events', idempotencyKey: 'connected-0001',
    });
    expect(await started.cal.p.calendarAccounting.getBudget(
      USER, submitted.sessionId, submitted.turnId)).toBeNull();
    await started.service.operations.runtime.executeTurn({
      userId: USER, sessionId: submitted.sessionId, turnId: submitted.turnId,
      attemptId: submitted.attemptId, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {},
    });
    expect(await started.cal.p.calendarAccounting.getBudget(
      USER, submitted.sessionId, submitted.turnId)).not.toBeNull();
    expect(started.cal.modelBodies).toHaveLength(1);
    expect((started.cal.modelBodies[0].tools as Array<{ function: { name: string } }>).map(
      tool => tool.function.name)).toEqual(['activate_skill', 'call_tool']);
  } finally {
    await started.dispose();
  }
});

it('keeps Calendar tools away from the model without a connected account', async () => {
  const started = await assembledCalendarApp({
    limits: catalogueLimits,
    calendarEvidence: () => frozenEvidence,
    connected: false,
  });
  try {
    started.cal.modelWires.push(FRAMES.normal);
    const submitted = await started.service.operations.runtime.submitTurn({
      identity: { userId: USER, openRouterUser: USER, source: 'authenticated-session' },
      sessionId: null, content: 'Hello', idempotencyKey: 'no-account-0001',
    });
    await started.service.operations.runtime.executeTurn({
      userId: USER, sessionId: submitted.sessionId, turnId: submitted.turnId,
      attemptId: submitted.attemptId, signal: new AbortController().signal,
      emit: async () => {}, emitCalendar: async () => {},
    });
    expect(started.cal.modelBodies).toHaveLength(1);
    expect(started.cal.modelBodies[0].tools).toBeUndefined();
    expect(await started.cal.p.calendarAccounting.getBudget(
      USER, submitted.sessionId, submitted.turnId)).toBeNull();
    const status = await started.service.operations.runtime.getTurnStatus(
      USER, submitted.sessionId, submitted.turnId);
    expect(status.status).toBe('completed');
  } finally {
    await started.dispose();
  }
});

it('uses cached v2 reconnect status rather than legacy target status for admission', async () => {
  const original = GoogleCalendarConnections.prototype.statusV2;
  const status = vi.spyOn(GoogleCalendarConnections.prototype, 'statusV2')
    .mockImplementation(async function (this: GoogleCalendarConnections) {
      return { ...await original.call(this), state: 'reconnect-required' as const,
        enabled: true, missingScopes: [CALENDAR_SCOPES[2]] };
    });
  const h = await assembledCalendarApp();
  try {
    expect(h.service.configFor(USER)!.calendar!.enabled).toBe(false);
    await h.service.calendarFor(USER).connections.statusV2();
    expect(status).toHaveBeenCalled();
    expect(h.service.configFor(USER)!.calendar!.enabled).toBe(false);
    h.fetcher.mockClear();
    for (let i = 0; i < 3; i += 1) {
      await h.service.operations.readiness.read();
      await h.service.calendarFor(USER).connections.statusV2();
    }
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { status.mockRestore(); await h.dispose(); }
});

it('fences the cached capability immediately when the current account requires reconnect', async () => {
  const h = await assembledCalendarApp();
  try {
    await h.service.calendarFor(USER).connections.statusV2();
    const account = await h.service.calendarFor(USER).connections.currentAccount();
    expect(h.service.configFor(USER)!.calendar!.enabled).toBe(true);
    await h.service.calendarFor(USER).connections.rejectUnauthorizedAccount(account);
    expect(h.service.configFor(USER)!.calendar!.enabled).toBe(false);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});

it('does not project enabled Calendar into a text-only model snapshot', async () => {
  const h = await assembledCalendarApp({ limits: textOnlyLimits, calendarEvidence: () => null });
  try {
    expect((await h.service.operations.readiness.read()).calendar?.enabled).toBe(false);
    expect(h.service.currentConfig.current()?.calendar?.enabled).toBe(false);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});
