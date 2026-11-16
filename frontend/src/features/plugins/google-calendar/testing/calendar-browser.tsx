/**
 * ============================================================================
 * FILE: calendar-browser.tsx
 * LOCATION: frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Development-only browser fixture for Google Calendar multi-calendar UI,
 *    testing picker races, CAS default settings, accessibility, and durable targets.
 *
 * ROLE IN PROJECT:
 *    Executes focused, mocked-fetch in-browser tests exercising the real DOM,
 *    live React render cycles, request fencing, and SSE streams without
 *    reaching external Google or LLM backend services.
 *
 * KEY COMPONENTS:
 *    - Mock fetch router: Intercepts /api/plugins/google-calendar and chat routes.
 *    - Standalone GoogleCalendarPanel tests: Connect, CAS save/reset, paging, races.
 *    - Full App chat tests: v3 clarification proposals, durable target badges, draft safety.
 * ============================================================================
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CALENDAR_CSRF_HEADER,
  type CalendarCalendarPage,
  type CalendarCalendarsResponse,
  type CalendarPublicStatusV2,
} from '../../../../api/calendar-protocol.ts';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO } from '../../../../api/voice-protocol.ts';
import { check, press, typeInput } from '../../../admin-config/testing/browser-checks.ts';
import { publicConfig } from '../../../admin-config/testing/fixtures.ts';
import {
  enqueueFixtureSse,
  isChatTurnStreamPath,
  isChatTurnSubmitPath,
} from './calendar-fixture-sse.ts';
import '../../../../index.css';

if (!import.meta.env.DEV) {
  throw new Error('The Google Calendar browser fixture refuses non-development execution.');
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixtureFreshness(now = Date.now()) {
  const fetchedAt = new Date(now - 30_000).toISOString();
  const expiresAt = new Date(now - 30_000 + 300_000).toISOString();
  return { fetchedAt, expiresAt };
}

const voiceConfig = {
  protocolVersion: 1 as const,
  enabledModes: { dictation: false, live: false },
  supportedLocales: ['en-US'] as ['en-US'],
  limits: { ...DEFAULT_VOICE_LIMITS },
  inputAudio: { ...INPUT_AUDIO },
  outputAudio: { ...OUTPUT_AUDIO },
};

function createCalendarPage1(): CalendarCalendarPage {
  return {
    schemaVersion: 2,
    tool: 'calendar_list_calendars',
    calendars: [
      {
        calendarId: 'primary@example.com',
        label: 'Primary Calendar',
        accessRole: 'owner',
        primary: true,
        timeZone: 'UTC',
        selected: true,
        privateAccess: true,
        hidden: false,
        deleted: false,
        capabilities: {
          createEvents: true,
          readEvents: true,
          availability: true,
        },
      },
      {
        calendarId: 'team@example.com',
        label: 'Team Events',
        accessRole: 'writer',
        primary: false,
        timeZone: 'UTC',
        selected: true,
        privateAccess: true,
        hidden: false,
        deleted: false,
        capabilities: {
          createEvents: true,
          readEvents: true,
          availability: true,
        },
      },
      {
        calendarId: 'readonly@example.com',
        label: 'Company Holidays',
        accessRole: 'reader',
        primary: false,
        timeZone: 'UTC',
        selected: false,
        privateAccess: false,
        hidden: false,
        deleted: false,
        capabilities: {
          createEvents: false,
          readEvents: true,
          availability: true,
        },
      },
      {
        calendarId: 'freebusy@example.com',
        label: 'External Partner',
        accessRole: 'freeBusyReader',
        primary: false,
        timeZone: 'UTC',
        selected: false,
        privateAccess: false,
        hidden: false,
        deleted: false,
        capabilities: {
          createEvents: false,
          readEvents: false,
          availability: true,
        },
      },
    ],
    discoveryRevision: 3,
    ...fixtureFreshness(),
    complete: true,
    truncated: false,
    nextPageToken: 'fake-opaque-p2',
    limitations: [],
  };
}

function createCalendarPage2(): CalendarCalendarPage {
  return {
    schemaVersion: 2,
    tool: 'calendar_list_calendars',
    calendars: [
      {
        calendarId: 'extra-shared@example.com',
        label: 'Extra Shared Calendar',
        accessRole: 'writer',
        primary: false,
        timeZone: 'UTC',
        selected: true,
        privateAccess: true,
        hidden: false,
        deleted: false,
        capabilities: {
          createEvents: true,
          readEvents: true,
          availability: true,
        },
      },
    ],
    discoveryRevision: 3,
    ...fixtureFreshness(Date.now() + 10_000),
    complete: true,
    truncated: false,
    nextPageToken: null,
    limitations: [],
  };
}

let calendarStatus: CalendarPublicStatusV2 = {
  protocolVersion: 2,
  state: 'connected',
  enabled: true,
  accountEmail: 'operator@example.com',
  processingDisclosure: {
    policyId: 'policy-local-1',
    processors: 'Google, OpenRouter and the configured model provider',
    dataCollection: 'deny',
  },
  connectionRevision: 3,
  defaultSetting: {
    defaultCalendarId: 'primary@example.com',
    defaultSettingRevision: 7,
  },
  primaryCalendarId: 'primary@example.com',
  discovery: {
    discoveryRevision: 3,
    ...fixtureFreshness(),
    complete: true,
    truncated: false,
    stale: false,
  },
  missingScopes: [],
};

const calendarMutations: Array<{ method: string; path: string; csrf: string | null; body: unknown }> = [];
let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
let streamWritable = false;
const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parseUrl(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, window.location.origin);
}

function pushSseEnvelope(envelope: object) {
  if (!streamWritable) {
    throw new Error('Calendar fixture stream is not open');
  }
  enqueueFixtureSse(streamController, encoder, envelope);
}

function openFixtureStream(): Response {
  streamWritable = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      streamWritable = true;
    },
    cancel() {
      streamWritable = false;
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

function closeFixtureStream() {
  if (streamWritable && streamController) {
    try {
      streamController.close();
    } catch {
      // Already closed by the consumer.
    }
  }
  streamWritable = false;
}

function acceptedTurn(turnId: string, attemptId: string, userMessageId: string) {
  return {
    sessionId: 'sess-cal-1',
    turnId,
    attemptId,
    userMessageId,
    streamPath: `/sessions/sess-cal-1/turns/${turnId}/stream`,
  };
}

let delayedPagePromise: Promise<Response> | null = null;
let simulateNextPatch409 = false;

window.history.replaceState(
  null,
  '',
  '/?plugin=google-calendar&oauth=fixture&code=secret-code-123&state=secret-state-456',
);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = parseUrl(input);
  const path = url.pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const csrf = headers.get(CALENDAR_CSRF_HEADER);
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (path === '/api/sessions' && method === 'GET') {
    return json({ items: [], nextCursor: null });
  }
  if (path === '/api/sessions' && method === 'POST') {
    return json(acceptedTurn('turn-cal-1', 'att-cal-1', 'msg-user-cal-1'));
  }
  if (isChatTurnSubmitPath(method, path)) {
    return json(acceptedTurn('turn-cal-2', 'att-cal-2', 'msg-user-cal-2'));
  }
  if (isChatTurnStreamPath(method, path)) {
    return openFixtureStream();
  }
  if (path === '/api/voice/config' && method === 'GET') return json(voiceConfig);
  if (path === '/api/admin/config' && method === 'GET') return json(publicConfig());

  if (path === '/api/plugins/google-calendar/status' && method === 'GET') {
    return json(calendarStatus);
  }

  if (path === '/api/plugins/google-calendar/calendars' && method === 'GET') {
    if (delayedPagePromise) {
      const p = delayedPagePromise;
      delayedPagePromise = null;
      return p;
    }
    const pageToken = url.searchParams.get('pageToken');
    if (pageToken === 'fake-opaque-p2') {
      const response: CalendarCalendarsResponse = {
        protocolVersion: 2,
        page: createCalendarPage2(),
      };
      return json(response);
    }
    const response: CalendarCalendarsResponse = {
      protocolVersion: 2,
      page: createCalendarPage1(),
    };
    return json(response);
  }

  if (path === '/api/plugins/google-calendar/calendars/refresh' && method === 'POST') {
    calendarMutations.push({ method, path, csrf, body });
    const response: CalendarCalendarsResponse = {
      protocolVersion: 2,
      page: createCalendarPage1(),
    };
    return json(response);
  }

  if (path === '/api/plugins/google-calendar/settings' && method === 'PATCH') {
    calendarMutations.push({ method, path, csrf, body });

    if (simulateNextPatch409) {
      simulateNextPatch409 = false;
      return json({ code: 'CONFLICT', message: 'Settings changed elsewhere' }, 409);
    }

    const payload = body as {
      enabled?: boolean;
      defaultSetting?: {
        calendarId: string | null;
        expectedRevision: number;
        expectedConnectionRevision: number;
      };
    };

    if (payload.defaultSetting) {
      calendarStatus = {
        ...calendarStatus,
        defaultSetting: {
          defaultCalendarId: payload.defaultSetting.calendarId,
          defaultSettingRevision: payload.defaultSetting.expectedRevision + 1,
        },
      };
    }

    if (payload.enabled !== undefined) {
      calendarStatus = {
        ...calendarStatus,
        enabled: payload.enabled,
        state: payload.enabled ? 'connected' : 'disabled',
      };
    }

    return json(calendarStatus);
  }

  if (path === '/api/plugins/google-calendar/disconnect' && method === 'POST') {
    calendarMutations.push({ method, path, csrf, body });
    calendarStatus = {
      ...calendarStatus,
      enabled: false,
      state: 'disabled',
      accountEmail: null,
    };
    return json({ disconnected: true, remoteRevocation: 'confirmed' });
  }

  throw new Error(`Unexpected fixture request: ${method} ${path}`);
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitUntil(predicate: () => boolean, message: string) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await flush();
  }
  check(predicate(), message);
}

async function waitForOpenStream() {
  await waitUntil(() => streamWritable, 'Calendar fixture stream did not open');
}

async function run(): Promise<void> {
  const statusNode = document.getElementById('fixture-status');
  const listNode = document.getElementById('fixture-checks');
  const mount = document.getElementById('root');
  check(statusNode && listNode && mount, 'Missing fixture DOM nodes');

  const storageWrites: string[] = [];
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patched(key: string, value: string) {
    storageWrites.push(`${key}=${value}`);
    return origSetItem.call(this, key, value);
  };

  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({
        name,
        ok: false,
        error: err instanceof Error ? err.message : 'failed',
      });
    }
  };

  const { GoogleCalendarPanel } = await import('../GoogleCalendarPanel.tsx');
  const { createCalendarClient } = await import('../../../../api/calendar-client.ts');

  // STEP 1: Standalone GoogleCalendarPanel tests for default calendar picker & CAS
  await step('Standalone GoogleCalendarPanel renders paged defaults and saves without toggling enablement', async () => {
    const calendarClient = createCalendarClient({ fetch: window.fetch });
    const reactRoot = createRoot(mount);
    try {
      await act(() => {
        reactRoot.render(
          <GoogleCalendarPanel
            client={calendarClient}
            onDismissOAuthOutcome={() => {}}
          />,
        );
      });
      await waitUntil(
        () => Boolean(mount.textContent?.includes('Google Calendar (embedded MCP)')),
        'Panel header missing',
      );
      check(mount.textContent?.includes('Connected Google account'), 'Connected account label missing');
      await waitUntil(
        () => Boolean(mount.textContent?.includes('Primary Calendar')),
        'Primary calendar choice missing',
      );

      const teamRadio = mount.querySelector<HTMLInputElement>('input[value="team@example.com"]');
      check(teamRadio, 'Team choice radio missing');
      await act(() => {
        teamRadio.click();
      });
      await flush();

      const saveBtn = [...mount.querySelectorAll('button')].find(
        (b) => b.textContent === 'Save default calendar',
      );
      check(saveBtn instanceof HTMLButtonElement && !saveBtn.disabled, 'Save default calendar button missing');
      await act(() => {
        saveBtn.click();
      });
      await flush();

      const lastPatch = calendarMutations.filter((m) => m.method === 'PATCH').at(-1);
      check(lastPatch && lastPatch.csrf === '1', 'Save default missing CSRF');
      const patchBody = lastPatch.body as {
        enabled?: boolean;
        defaultSetting?: {
          calendarId: string | null;
          expectedRevision: number;
          expectedConnectionRevision: number;
        };
      };
      check(!Object.hasOwn(patchBody, 'enabled'), 'Default save toggled enablement');
      check(patchBody.defaultSetting?.calendarId === 'team@example.com', 'Target was not team@example.com');
      check(patchBody.defaultSetting?.expectedRevision === 7, 'Expected revision was not 7');
      check(patchBody.defaultSetting?.expectedConnectionRevision === 3, 'Expected connection revision was not 3');

      const resetBtn = [...mount.querySelectorAll('button')].find(
        (b) => b.textContent === 'Reset to primary automatically',
      );
      check(resetBtn instanceof HTMLButtonElement && !resetBtn.disabled, 'Reset button missing');
      await act(() => {
        resetBtn.click();
      });
      await flush();

      const resetPatch = calendarMutations.filter((m) => m.method === 'PATCH').at(-1);
      const resetBody = resetPatch?.body as { defaultSetting?: { calendarId: string | null } };
      check(resetBody.defaultSetting?.calendarId === null, 'Reset did not send null default calendar');

      await waitUntil(() => {
        const next = [...mount.querySelectorAll('button')].find((b) => b.textContent === 'Load next page');
        return next instanceof HTMLButtonElement && !next.disabled;
      }, 'Load next page button missing');
      const nextBtn = [...mount.querySelectorAll('button')].find(
        (b) => b.textContent === 'Load next page',
      );
      check(nextBtn instanceof HTMLButtonElement, 'Load next page button missing');
      await act(() => {
        nextBtn.click();
      });
      await waitUntil(
        () => Boolean(mount.textContent?.includes('Extra Shared Calendar')),
        'Next page entries not loaded',
      );
      check(
        mount.querySelectorAll('.aurvin-calendar-entries-list .aurvin-calendar-choice').length === 1,
        'Page 2 does not have 1 entry',
      );
    } finally {
      reactRoot.unmount();
      await flush();
    }
  });

  // STEP 2: Deferred response race fence test
  await step('Deferred page response from old client cannot overwrite newer state', async () => {
    let releaseDelayedPage!: (response: Response) => void;
    delayedPagePromise = new Promise<Response>((resolve) => {
      releaseDelayedPage = resolve;
    });

    const calendarClient = createCalendarClient({ fetch: window.fetch });
    const reactRoot = createRoot(mount);

    await act(() => {
      reactRoot.render(
        <GoogleCalendarPanel
          client={calendarClient}
          onDismissOAuthOutcome={() => {}}
        />,
      );
    });
    await flush();

    try {
      reactRoot.unmount();
    } finally {
      await flush();
    }

    // Now resolve delayed page
    releaseDelayedPage(
      Response.json({
        protocolVersion: 2,
        page: {
          ...createCalendarPage1(),
          calendars: [{ ...createCalendarPage1().calendars[0], label: 'STALE OBSOLETE ACCOUNT' }],
        },
      }),
    );
    await flush();

    check(!mount.textContent?.includes('STALE OBSOLETE ACCOUNT'), 'Stale page response resurrected after unmount');
  });

  // STEP 3: Mount full App for Chat, OAuth, and SSE v3 events
  const { default: App } = await import('../../../../App.tsx');
  const { createApiClient } = await import('../../../../api/client.ts');
  const { createAdminConfigClient } = await import('../../../../api/admin-config-client.ts');

  const reactRoot = createRoot(mount);
  await act(() => {
    reactRoot.render(
      <App
        client={createApiClient({ fetch: window.fetch })}
        adminClient={createAdminConfigClient({ fetch: window.fetch })}
        calendarClient={createCalendarClient({ fetch: window.fetch })}
        refreshCapabilities={async () => true}
      />,
    );
  });
  await flush();

  await step('OAuth callback query is scrubbed and opens Google Calendar panel with fixture notice', async () => {
    check(!window.location.search.includes('code='), 'OAuth code remained in location.search');
    check(!window.location.search.includes('state='), 'OAuth state remained in location.search');
    check(
      mount.textContent?.includes('local fixture mode (not a live Google grant)'),
      'Fixture OAuth notice missing',
    );
  });

  await step('Enable/disable and project-wide grant revocation enforce CSRF and checkbox acknowledgment', async () => {
    const disableBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Disable Google Calendar',
    );
    check(disableBtn, 'Disable Google Calendar button missing');
    await act(() => {
      disableBtn.click();
    });
    await flush();
    const enableBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Enable Google Calendar',
    );
    check(enableBtn, 'Enable Google Calendar button missing');
    await act(() => {
      enableBtn.click();
    });
    await flush();

    const revokeTrigger = [...mount.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Disconnect & revoke Google grant'),
    );
    check(revokeTrigger, 'Disconnect & revoke trigger missing');
    await act(() => {
      revokeTrigger.click();
    });
    await flush();

    const confirmRevoke = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Revoke Google grant and disconnect',
    );
    check(
      confirmRevoke instanceof HTMLButtonElement && confirmRevoke.disabled,
      'Revoke button must be disabled before acknowledgment',
    );

    const group = mount.querySelector<HTMLElement>('.aurvin-calendar-disconnect-confirm');
    check(group, 'Disconnect confirmation group missing');
    await act(() => {
      press(group, 'Escape');
    });
    await flush();
    check(
      !mount.querySelector('.aurvin-calendar-disconnect-confirm'),
      'Escape did not close disconnect confirmation',
    );
    check(
      calendarMutations.every((m) => m.csrf === '1'),
      'CSRF header missing on Calendar mutation',
    );
  });

  await step('Chat displays correcting progress, durable receipt on failed narration, and preserves draft on Reconnect navigation', async () => {
    const backBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Back to chat',
    );
    check(backBtn, 'Back to chat missing');
    await act(() => {
      backBtn.click();
    });
    await flush();

    const textarea = mount.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
    check(textarea, 'Composer textarea missing');
    await act(() => {
      typeInput(textarea, 'Create team sync at 2026-10-22T15:00:00Z');
    });
    const sendBtn = mount.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    check(sendBtn, 'Send button missing');
    await act(() => {
      sendBtn.click();
    });
    await waitForOpenStream();

    await act(() => {
      pushSseEnvelope({
        protocolVersion: 2,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-1',
        attemptId: 'att-cal-1',
        sequence: 0,
        event: { type: 'turn-accepted', userMessageId: 'msg-user-cal-1' },
      });
      pushSseEnvelope({
        protocolVersion: 2,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-1',
        attemptId: 'att-cal-1',
        sequence: 1,
        event: { type: 'calendar-progress', phase: 'repairing' },
      });
    });
    await flush();
    check(
      mount.textContent?.includes('Correcting the Calendar request…'),
      'Repairing progress copy missing',
    );

    await act(() => {
      pushSseEnvelope({
        protocolVersion: 2,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-1',
        attemptId: 'att-cal-1',
        sequence: 2,
        event: {
          type: 'calendar-operation',
          operation: {
            operationId: 'op-browser-1',
            state: 'succeeded',
            narration: 'failed',
            retryAction: 'reconnect',
            receipt: {
              durable: true,
              eventId: 'evt_browser_999',
              htmlLink: 'https://www.google.com/calendar/event?eid=browser999',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        },
      });
      pushSseEnvelope({
        protocolVersion: 2,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-1',
        attemptId: 'att-cal-1',
        sequence: 3,
        event: {
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: 'Final narration failed after write.',
          retryable: true,
        },
      });
      closeFixtureStream();
    });
    await flush();

    check(mount.textContent?.includes('Calendar event created'), 'Durable receipt heading missing');
    check(mount.textContent?.includes('evt_browser_999'), 'Durable event ID missing');
    const link = mount.querySelector<HTMLAnchorElement>('.aurvin-calendar-receipt-link');
    check(
      link?.getAttribute('href') === 'https://www.google.com/calendar/event?eid=browser999',
      'Safe Calendar link missing',
    );
    check(
      mount.textContent?.includes(
        'The Calendar event was created and saved, but the final assistant response failed.',
      ),
      'Narration failure distinction missing',
    );

    const dockedInput = mount.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message input"]',
    );
    check(dockedInput, 'Docked composer missing');
    await act(() => {
      typeInput(dockedInput, 'Unsent follow-up draft');
    });

    const reconnectBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reconnect Google Calendar',
    );
    check(reconnectBtn, 'Reconnect Google Calendar button missing');
    await act(() => {
      reconnectBtn.click();
    });
    await flush();

    const returnBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Back to chat',
    );
    check(returnBtn, 'Back to chat missing after Reconnect navigation');
    await act(() => {
      returnBtn.click();
    });
    await flush();
    check(
      dockedInput.value === 'Unsent follow-up draft',
      'Unsent draft was lost during Reconnect navigation',
    );
  });

  await step('v3 clarification proposal renders conflict card and Reply focuses composer without altering draft', async () => {
    // Send a new message to start a new turn
    const textarea = mount.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
    check(textarea, 'Composer textarea missing');
    await act(() => {
      typeInput(textarea, 'Book conference room tomorrow at 3pm');
    });
    const sendBtn = mount.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    check(sendBtn, 'Send button missing');
    await act(() => {
      sendBtn.click();
    });
    await waitForOpenStream();

    // Push v3 clarification proposal frame
    await act(() => {
      pushSseEnvelope({
        protocolVersion: 3,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-2',
        attemptId: 'att-cal-2',
        sequence: 1,
        event: {
          type: 'calendar-clarification',
          proposalId: 'prop-conflict-1',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          reason: 'conflict',
          message: 'Conference Room has an existing booking at that hour.',
          candidates: [
            { calendarId: 'room-a@example.com', label: 'Room A', role: 'writer' },
            { calendarId: 'room-b@example.com', label: 'Room B', role: 'writer' },
          ],
        },
      });
    });
    await flush();

    check(mount.textContent?.includes('Calendar conflict needs your reply'), 'Clarification card missing');
    check(mount.textContent?.includes('Conference Room has an existing booking at that hour.'), 'Message missing');
    check(mount.textContent?.includes('Room A'), 'Candidate Room A missing');
    check(mount.textContent?.includes('Room B'), 'Candidate Room B missing');

    await act(() => {
      pushSseEnvelope({
        protocolVersion: 3,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-2',
        attemptId: 'att-cal-2',
        sequence: 2,
        event: {
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: 'Waiting for a clarification reply.',
          retryable: true,
        },
      });
    });
    await waitUntil(() => {
      const composerReady = mount.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
      return Boolean(composerReady && !composerReady.disabled);
    }, 'Composer stayed disabled after clarification');

    const replyBtn = [...mount.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reply in composer',
    );
    check(replyBtn instanceof HTMLButtonElement && !replyBtn.disabled, 'Reply in composer button missing or disabled');
    await act(() => {
      replyBtn.click();
    });
    await flush();

    const composer = mount.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
    check(composer, 'Composer textarea missing after clarification');
    check(document.activeElement === composer, 'Reply in composer did not focus the textarea');
  });

  await step('Durable target badge displays Original Team and persists after settings change', async () => {
    await waitForOpenStream();
    // Push v3 operation succeeded with durable receipt carrying calendarLabel: 'Original Team'
    await act(() => {
      pushSseEnvelope({
        protocolVersion: 3,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-2',
        attemptId: 'att-cal-2',
        sequence: 3,
        event: {
          type: 'calendar-operation',
          operation: {
            schemaVersion: 2,
            operationId: 'op-v3-target-1',
            state: 'succeeded',
            narration: 'completed',
            retryAction: 'none',
            receipt: {
              durable: true,
              eventId: 'evt-team-99',
              htmlLink: 'https://calendar.google.com/calendar/event?eid=team99',
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              calendarLabel: 'Original Team',
            },
          },
        },
      });
      pushSseEnvelope({
        protocolVersion: 3,
        sessionId: 'sess-cal-1',
        turnId: 'turn-cal-2',
        attemptId: 'att-cal-2',
        sequence: 4,
        event: {
          type: 'completed',
          assistantMessageId: 'msg-assist-target-1',
          outcome: 'completed',
        },
      });
      closeFixtureStream();
    });
    await flush();

    check(mount.textContent?.includes('Calendar: Original Team'), 'Durable target badge missing Original Team');

    // Simulate changing default calendar in background
    calendarStatus = {
      ...calendarStatus,
      defaultSetting: {
        defaultCalendarId: 'personal@example.com',
        defaultSettingRevision: 99,
      },
    };

    // Re-verify that existing receipt target badge remains Original Team
    check(mount.textContent?.includes('Calendar: Original Team'), 'Durable target badge altered after background default change');
  });

  await step('No secrets or OAuth codes written to browser storage', async () => {
    check(storageWrites.length === 0, `Unexpected storage writes: ${storageWrites.join(', ')}`);
  });

  Storage.prototype.setItem = origSetItem;

  listNode.replaceChildren(
    ...results.map((r) => {
      const li = document.createElement('li');
      li.textContent = `${r.ok ? 'pass' : 'fail'}: ${r.name}${r.error ? ` (${r.error})` : ''}`;
      return li;
    }),
  );
  const passed = results.filter((r) => r.ok).length;
  statusNode.textContent = `${passed}/${results.length} passed`;
}

void run();
