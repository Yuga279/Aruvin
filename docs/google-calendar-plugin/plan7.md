# Google Calendar Plugin — Plan P7: Frontend Connection and Chat Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Google Calendar connection/setup UI, client wire protocol v2, safe OAuth navigation/callback scrubbing, and chat progress, durable event receipts, narration-failure distinction, and retry/reconnect/clarification flows.

**Architecture:** Mirror the frozen P1 wire contracts (`backend/src/contracts/calendar-wire.ts`, `backend/src/contracts/api.ts`) and P3 setup routes (`backend/src/plugins/google-calendar/controller*.ts`) in `frontend/src/api/` using zero-dependency runtime type guards and a bounded, CSRF-protected `CalendarClient`. Provide a pure setup state reducer and accessible `GoogleCalendarPanel` under `frontend/src/features/plugins/google-calendar/` mounted inside `AdminDashboard`, and extend `ChatState` and `ChatView` with `CalendarTurnRegion` so in-flight progress (`validating`, `repairing`, `executing`, `reconciling`), durable event receipts, narration-failure distinction, and action-specific retry/reconnect/clarification states render accurately while preserving unsent drafts and unsaved New Chat behavior.

**Tech Stack:** React 19, TypeScript 6 (`erasableSyntaxOnly`, `verbatimModuleSyntax`, bundler module resolution with `.ts`/`.tsx` specifiers), Vite 8, Vitest 4 (Node SSR/state test suites plus a development-only closed browser fixture).

---

## Scope, Rules, and Compatibility Assumptions

- **Owned paths:** `frontend/src/api/**`, `frontend/src/features/plugins/**` (excluding `frontend/src/features/plugins/integration-tests/**`, which is reserved for P9), necessary edits in `frontend/src/features/admin-config/**` and `frontend/src/features/chat/**`, and `frontend/src/App.tsx` with its assembly/style checks.
- **Preserved user work:** Do not touch or revert `3510157` (`frontend/src/components/MessageItem.tsx`, `frontend/src/components/MessageItem.test.ts`, or user changes in `frontend/src/main.tsx`, `frontend/src/styles/chat.css`, `frontend/src/styles/styles.test.ts`, `frontend/src/styles/scrollbars.css`).
- **No file-header comment blocks:** Omit repository file-header comment blocks in all new and modified files in this plan.
- **No live Google OAuth in tests:** Routine tests use deterministic in-memory/mocked `fetch` fixtures in Node (`npm test -- <relative-test-path>`) and a closed development-only browser fixture. Browser results remain separate from live service certification.
- **Security and privacy invariants:**
  - Never accept or send client-supplied `userId`, `user`, `openRouterUser`, `model`, `modelId`, `apiKey`, `calendarId`, `accountId`, `connectionId`, `googleSubjectId`, `accessToken`, `refreshToken`, `clientSecret`, `authorization`, or `serviceUrl`.
  - Send `X-Aurvin-Calendar-CSRF: 1` and `Content-Type: application/json` on all state-changing Calendar setup calls (`PATCH /plugins/google-calendar/settings`, `POST /plugins/google-calendar/oauth/start`, `POST /plugins/google-calendar/disconnect`).
  - Validate OAuth redirect URLs strictly against `https://accounts.google.com/o/oauth2/v2/auth` (no credentials, no hash) before navigating.
  - Validate Calendar receipt links strictly against `https://` on `www.google.com`, `calendar.google.com`, or `google.com` with pathname `/calendar/event` (no credentials, no port) and non-expired `expiresAt`.
  - Scrub `?plugin=google-calendar&oauth=...` and any stray OAuth/token parameters (`code`, `state`, `scope`, `error`, `access_token`, `refresh_token`, `id_token`, `client_secret`) from the browser URL via `window.history.replaceState` without writing anything to `localStorage`, `sessionStorage`, or cookies.
  - Never render a false "Created" receipt from provisional streamed assistant text (`streamText`). Only `CalendarTurnState` with `state === 'succeeded'` and `receipt.durable === true` renders a created-event receipt.

---

## File Map

- **Create:** `frontend/src/api/calendar-protocol.ts` — Pure runtime guards, route constants, CSRF header constants, OAuth URL / receipt link validators, v2 stream envelope parser, and OAuth callback URL scrubber.
- **Create:** `frontend/src/api/calendar-protocol.test.ts` — Unit tests for Calendar wire guards, link/OAuth validators, v1/v2 stream frame compatibility, and URL scrubbing.
- **Modify:** `frontend/src/api/protocol.ts` — Extend `OVERRIDE_KEYS` for Calendar/plugin fields, allow optional `calendarProtocol: 2` on `SubmitTurnRequest` and `RetryTurnRequest`, add `isRetryTurnRequest` and `isTurnStatusResponse` (with optional `calendar: CalendarTurnState`), and re-export Calendar wire types/parsers.
- **Modify:** `frontend/src/api/protocol.test.ts` — Unit tests for `calendarProtocol: 2`, `TurnStatusResponse` validation, and Calendar override rejection.
- **Create:** `frontend/src/api/calendar-client.ts` — Bounded `no-store` HTTP client (`getStatus`, `updateSettings`, `startOAuth`, `disconnect`) with CSRF header injection and safe `CalendarClientError` mapping.
- **Create:** `frontend/src/api/calendar-client.test.ts` — Unit tests for `CalendarClient` methods, CSRF header enforcement, bounded responses, and error handling.
- **Modify:** `frontend/src/api/client.ts` — Support `parseCalendarCompatibleFrame` in `connectTurnStream`, validate `RetryTurnRequest` and `TurnStatusResponse`, and pass `CalendarStreamEvent` to stream handlers.
- **Modify:** `frontend/src/api/client.test.ts` — Unit tests for v2 `calendar-progress` and `calendar-operation` SSE frames and `getTurnStatus` with `calendar`.
- **Create:** `frontend/src/features/plugins/google-calendar/calendar-setup-state.ts` — Pure setup state machine, connection status copy, OAuth start navigation helper, and local-disconnect vs project-wide Google grant revocation state/copy.
- **Create:** `frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts` — Unit tests for setup state transitions, `fixture` vs `connected` callback copy, safe OAuth navigation, and two-mode disconnect confirmation.
- **Create:** `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx` — Accessible Calendar setup/status/enable/disconnect panel component.
- **Create:** `frontend/src/features/plugins/google-calendar/google-calendar-panel.test.ts` — Node `renderToStaticMarkup` tests for all connection states, target calendar display, processing disclosure, OAuth banners, and disconnect confirmation controls.
- **Create:** `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx` — Chat progress banner (`validating`, `repairing` -> `"Correcting the Calendar request…"`, `executing`, `reconciling`), durable event receipt card, narration-failure distinction, and retry/reconnect/clarify controls.
- **Create:** `frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts` — Node `renderToStaticMarkup` and presentation tests for progress phases, provisional text non-receipt guard, durable receipt with safe/unsafe/expired links, narration-failure distinction, and `retryAction` states.
- **Create:** `frontend/src/features/plugins/google-calendar/calendar-plugin.css` — Styles for `GoogleCalendarPanel` and `CalendarTurnRegion` with reduced-motion support.
- **Create:** `frontend/src/features/plugins/google-calendar/index.ts` — Barrel exports for the Google Calendar plugin feature.
- **Modify:** `frontend/src/features/chat/state/chat-types.ts` — Add `calendarProgress`, `calendarOperationsByTurn`, `calendarTurnOrder`, and `CALENDAR_PROGRESS` / `CALENDAR_OPERATION` actions.
- **Modify:** `frontend/src/features/chat/state/chat-reducer.ts` — Handle Calendar progress/operation actions, sync narration status on stream terminal events, and reset session Calendar state on `NEW_CHAT` / `SELECT_SESSION` while preserving `draftInput`.
- **Modify:** `frontend/src/features/chat/state/chat-reducer.test.ts` — Reducer unit tests for Calendar progress, durable receipt persistence across narration failure, and draft/new-chat preservation.
- **Modify:** `frontend/src/features/chat/state/use-chat.ts` — Send `calendarProtocol: 2` on text turn submit/retry, dispatch `CALENDAR_PROGRESS` and `CALENDAR_OPERATION` stream events, and reconcile `getTurnStatus` on interrupted/errored Calendar turns.
- **Modify:** `frontend/src/features/chat/ChatView.tsx` — Mount `CalendarTurnRegion` when live voice is inactive and wire `onOpenCalendarSetup` and composer clarification focus.
- **Modify:** `frontend/src/features/admin-config/AdminDashboard.tsx` — Add `Google Calendar` section (`'calendar'`) to `AdminDashboard` rail/select and mount `GoogleCalendarPanel`.
- **Modify:** `frontend/src/features/admin-config/admin-dashboard.test.ts` — Test `Google Calendar` section navigation and `initialSection="calendar"` SSR output.
- **Modify:** `frontend/src/App.tsx` — Wire `calendarClient`, scrub OAuth callback URL parameters on mount via `history.replaceState`, and route OAuth callback outcomes and `Reconnect Google Calendar` actions to `AdminDashboard` (`initialSection="calendar"`) while keeping `ChatProvider` mounted and inert.
- **Modify:** `frontend/src/App.assembly.test.ts` — Test `calendarClient` injection, OAuth callback URL scrubbing, and absence of secret/env leaks.
- **Create:** `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html` and `frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx` — Closed development-only browser fixture for keyboard, focus, safe link, OAuth scrubbing, and chat progress/receipt/retry verification.

---

### Task 1: Mirror Frozen P1 Calendar Wire Contracts and URL Scrubbing in `frontend/src/api/`

**Files:**
- Create: `frontend/src/api/calendar-protocol.ts`
- Create: `frontend/src/api/calendar-protocol.test.ts`
- Modify: `frontend/src/api/protocol.ts`
- Modify: `frontend/src/api/protocol.test.ts`

- [ ] **Step 1: Write the failing tests in `frontend/src/api/calendar-protocol.test.ts` and `frontend/src/api/protocol.test.ts`**

Create `frontend/src/api/calendar-protocol.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_API_ROUTES,
  CALENDAR_CSRF_HEADER,
  CALENDAR_CSRF_VALUE,
  CALENDAR_PROTOCOL_VERSION,
  CALENDAR_STREAM_PROTOCOL_VERSION,
  extractAndScrubCalendarOAuthCallback,
  isCalendarDisconnectRequest,
  isCalendarDisconnectResponse,
  isCalendarOAuthStartRequest,
  isCalendarOAuthStartResponse,
  isCalendarPublicStatus,
  isCalendarSettingsRequest,
  isCalendarTurnState,
  isSafeCalendarEventLink,
  isSafeGoogleOAuthUrl,
  parseCalendarCompatibleFrame,
} from './calendar-protocol.ts';

describe('calendar-protocol wire guards', () => {
  it('exposes frozen routes, protocol versions, and CSRF header constants', () => {
    expect(CALENDAR_PROTOCOL_VERSION).toBe(1);
    expect(CALENDAR_STREAM_PROTOCOL_VERSION).toBe(2);
    expect(CALENDAR_CSRF_HEADER).toBe('X-Aurvin-Calendar-CSRF');
    expect(CALENDAR_CSRF_VALUE).toBe('1');
    expect(CALENDAR_API_ROUTES).toEqual({
      status: '/plugins/google-calendar/status',
      settings: '/plugins/google-calendar/settings',
      oauthStart: '/plugins/google-calendar/oauth/start',
      oauthCallback: '/plugins/google-calendar/oauth/callback',
      disconnect: '/plugins/google-calendar/disconnect',
    });
  });

  it('validates Google OAuth authorization URLs and rejects credentials, hashes, or wrong origins', () => {
    const valid =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=abc';
    expect(isSafeGoogleOAuthUrl(valid)).toBe(true);
    expect(isCalendarOAuthStartResponse({ authorizationUrl: valid })).toBe(true);

    expect(isSafeGoogleOAuthUrl('http://accounts.google.com/o/oauth2/v2/auth?state=1')).toBe(false);
    expect(isSafeGoogleOAuthUrl('https://evil.example.com/o/oauth2/v2/auth?state=1')).toBe(false);
    expect(isSafeGoogleOAuthUrl('https://accounts.google.com/other?state=1')).toBe(false);
    expect(isSafeGoogleOAuthUrl('https://user:pass@accounts.google.com/o/oauth2/v2/auth')).toBe(false);
    expect(isSafeGoogleOAuthUrl(`${valid}#fragment`)).toBe(false);
  });

  it('validates safe Google Calendar event links and rejects unsafe schemes, ports, or hosts', () => {
    expect(isSafeCalendarEventLink('https://www.google.com/calendar/event?eid=abc123')).toBe(true);
    expect(isSafeCalendarEventLink('https://calendar.google.com/calendar/event?eid=abc123')).toBe(true);
    expect(isSafeCalendarEventLink('https://google.com/calendar/event?eid=abc123')).toBe(true);

    expect(isSafeCalendarEventLink('javascript:alert(1)')).toBe(false);
    expect(isSafeCalendarEventLink('http://www.google.com/calendar/event?eid=abc123')).toBe(false);
    expect(isSafeCalendarEventLink('https://www.google.com:8443/calendar/event?eid=abc123')).toBe(false);
    expect(isSafeCalendarEventLink('https://www.google.com/calendar/other?eid=abc123')).toBe(false);
    expect(isSafeCalendarEventLink('https://attacker.com/calendar/event?eid=abc123')).toBe(false);
  });

  it('validates CalendarPublicStatus and rejects leaked secrets or unknown fields', () => {
    const valid = {
      protocolVersion: 1 as const,
      state: 'connected' as const,
      enabled: true,
      accountEmail: 'operator@example.com',
      targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
      processingDisclosure: {
        policyId: 'policy-local-1',
        processors: 'Google, OpenRouter and the configured model provider' as const,
        dataCollection: 'deny' as const,
      },
    };
    expect(isCalendarPublicStatus(valid)).toBe(true);
    expect(
      isCalendarPublicStatus({
        ...valid,
        state: 'setup-required',
        enabled: false,
        accountEmail: null,
        targetCalendarId: null,
        processingDisclosure: null,
      }),
    ).toBe(true);
    expect(isCalendarPublicStatus({ ...valid, accessToken: 'secret' })).toBe(false);
    expect(isCalendarPublicStatus({ ...valid, accountEmail: 'not-an-email' })).toBe(false);
  });

  it('validates setup requests and distinguishes local disconnect from explicit grant revocation', () => {
    expect(isCalendarSettingsRequest({ enabled: true })).toBe(true);
    expect(isCalendarSettingsRequest({ enabled: true, userId: 'spoofed' })).toBe(false);
    expect(isCalendarOAuthStartRequest({})).toBe(true);
    expect(isCalendarOAuthStartRequest({ calendarId: 'primary' })).toBe(false);

    expect(isCalendarDisconnectRequest({ mode: 'local' })).toBe(true);
    expect(isCalendarDisconnectRequest({ mode: 'revoke-google-grant' })).toBe(false);
    expect(
      isCalendarDisconnectRequest({
        mode: 'revoke-google-grant',
        acknowledgeProjectWideRevocation: true,
      }),
    ).toBe(true);

    expect(
      isCalendarDisconnectResponse({
        disconnected: true,
        remoteRevocation: 'confirmed',
      }),
    ).toBe(true);
  });

  it('enforces CalendarTurnState receipt invariants and parses v1/v2 stream frames', () => {
    const succeededWithFailedNarration = {
      operationId: 'op_1',
      state: 'succeeded' as const,
      narration: 'failed' as const,
      retryAction: 'none' as const,
      receipt: {
        durable: true as const,
        eventId: 'abcde12345',
        htmlLink: 'https://www.google.com/calendar/event?eid=abc',
        expiresAt: '2026-10-22T12:00:00.000Z',
      },
    };
    expect(isCalendarTurnState(succeededWithFailedNarration)).toBe(true);
    expect(isCalendarTurnState({ ...succeededWithFailedNarration, state: 'unknown' })).toBe(false);
    expect(
      isCalendarTurnState({
        ...succeededWithFailedNarration,
        receipt: {
          ...succeededWithFailedNarration.receipt,
          expiresAt: null,
        },
      }),
    ).toBe(false);

    const v1 = {
      protocolVersion: 1,
      sessionId: 's1',
      turnId: 't1',
      attemptId: 'a1',
      sequence: 0,
      event: { type: 'delta', text: 'Hello' },
    };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(v1)}`)).toEqual(v1);

    const v2Progress = {
      ...v1,
      protocolVersion: 2,
      event: { type: 'calendar-progress', phase: 'repairing' },
    };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(v2Progress)}`)).toEqual(v2Progress);

    const v2Operation = {
      ...v1,
      protocolVersion: 2,
      event: { type: 'calendar-operation', operation: succeededWithFailedNarration },
    };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(v2Operation)}`)).toEqual(v2Operation);

    for (const forbidden of ['accessToken', 'refreshToken', 'arguments', 'checkpoint', 'diagnostics']) {
      expect(() =>
        parseCalendarCompatibleFrame(
          `data: ${JSON.stringify({
            ...v2Progress,
            event: { ...v2Progress.event, [forbidden]: 'secret' },
          })}`,
        ),
      ).toThrow(/invalid_stream_envelope/i);
    }
  });

  it('extracts OAuth callback outcome and scrubs OAuth/secret parameters from URLs', () => {
    const callbackUrl =
      'http://127.0.0.1:5173/?plugin=google-calendar&oauth=fixture&code=secret_code&state=secret_state#access_token=tok';
    const result = extractAndScrubCalendarOAuthCallback(callbackUrl);
    expect(result).toEqual({
      outcome: 'fixture',
      scrubbedPathAndSearch: '/',
      hadSensitiveParams: true,
    });

    const cleanUrl = 'http://127.0.0.1:5173/';
    expect(extractAndScrubCalendarOAuthCallback(cleanUrl)).toEqual({
      outcome: null,
      scrubbedPathAndSearch: '/',
      hadSensitiveParams: false,
    });
  });
});
```

Append tests to `frontend/src/api/protocol.test.ts` inside `describe('frontend protocol', ...)`:

```typescript
  it('accepts optional calendarProtocol: 2 on submit and retry requests and rejects invalid versions or Calendar overrides', () => {
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Schedule sync',
        idempotencyKey: 'idempotency-key-1',
        calendarProtocol: 2,
      }),
    ).toBe(true);
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Schedule sync',
        idempotencyKey: 'idempotency-key-1',
        calendarProtocol: 1 as unknown as 2,
      }),
    ).toBe(false);
    expect(() =>
      assertNoClientOverrides({ calendarId: 'primary', content: 'Hello' }),
    ).toThrowError(/Identity, model, and API keys/i);
    expect(() =>
      assertNoClientOverrides({ accessToken: 'tok', content: 'Hello' }),
    ).toThrowError(/Identity, model, and API keys/i);
  });
```

- [ ] **Step 2: Run the protocol test suites to verify they fail**

Run from `frontend/`:
```powershell
npm test -- src/api/calendar-protocol.test.ts src/api/protocol.test.ts
```
Expected: FAIL because `frontend/src/api/calendar-protocol.ts` does not exist yet and `calendarProtocol: 2` is not yet accepted in `protocol.ts`.

- [ ] **Step 3: Implement `frontend/src/api/calendar-protocol.ts` and update `frontend/src/api/protocol.ts`**

Create `frontend/src/api/calendar-protocol.ts`:

```typescript
import {
  isStreamEnvelope,
  isStreamEvent,
  type StreamEnvelope,
  type StreamEvent,
} from './protocol.ts';

export const CALENDAR_PROTOCOL_VERSION = 1 as const;
export const CALENDAR_STREAM_PROTOCOL_VERSION = 2 as const;
export const CALENDAR_CSRF_HEADER = 'X-Aurvin-Calendar-CSRF';
export const CALENDAR_CSRF_VALUE = '1';

export const CALENDAR_API_ROUTES = {
  status: '/plugins/google-calendar/status',
  settings: '/plugins/google-calendar/settings',
  oauthStart: '/plugins/google-calendar/oauth/start',
  oauthCallback: '/plugins/google-calendar/oauth/callback',
  disconnect: '/plugins/google-calendar/disconnect',
} as const;

export const CALENDAR_CONNECTION_STATES = [
  'disabled',
  'setup-required',
  'connected',
  'reconnect-required',
  'degraded',
] as const;
export type CalendarConnectionState = (typeof CALENDAR_CONNECTION_STATES)[number];

export const CALENDAR_OPERATION_STATES = [
  'planned',
  'dispatching',
  'succeeded',
  'definitely-failed',
  'unknown',
  'evidence-expired',
] as const;
export type CalendarOperationState = (typeof CALENDAR_OPERATION_STATES)[number];

export const CALENDAR_NARRATION_STATUSES = [
  'pending',
  'completed',
  'failed',
  'interrupted',
] as const;
export type CalendarNarrationStatus = (typeof CALENDAR_NARRATION_STATUSES)[number];

export const CALENDAR_RETRY_ACTIONS = [
  'none',
  'resume-reconciliation',
  'reconnect',
  'clarify',
  'blocked-expired',
] as const;
export type CalendarRetryAction = (typeof CALENDAR_RETRY_ACTIONS)[number];

export const CALENDAR_PROGRESS_PHASES = [
  'validating',
  'repairing',
  'executing',
  'reconciling',
] as const;
export type CalendarProgressPhase = (typeof CALENDAR_PROGRESS_PHASES)[number];

export const CALENDAR_REMOTE_REVOCATION_OUTCOMES = [
  'not-requested',
  'confirmed',
  'failed',
  'unknown',
] as const;
export type CalendarRemoteRevocationOutcome = (typeof CALENDAR_REMOTE_REVOCATION_OUTCOMES)[number];

export const CALENDAR_OAUTH_CALLBACK_OUTCOMES = [
  'connected',
  'fixture',
  'cancelled',
  'failed',
] as const;
export type CalendarOAuthCallbackOutcome = (typeof CALENDAR_OAUTH_CALLBACK_OUTCOMES)[number];

export type CalendarProcessingDisclosure = {
  policyId: string;
  processors: 'Google, OpenRouter and the configured model provider';
  dataCollection: 'deny';
};

export type CalendarPublicStatus = {
  protocolVersion: 1;
  state: CalendarConnectionState;
  enabled: boolean;
  accountEmail: string | null;
  targetCalendarId: string | null;
  processingDisclosure: CalendarProcessingDisclosure | null;
};

export type CalendarSettingsRequest = {
  enabled: boolean;
};

export type CalendarOAuthStartRequest = Record<string, never>;

export type CalendarOAuthStartResponse = {
  authorizationUrl: string;
};

export type CalendarDisconnectRequest =
  | { mode: 'local' }
  | { mode: 'revoke-google-grant'; acknowledgeProjectWideRevocation: true };

export type CalendarDisconnectResponse = {
  disconnected: true;
  remoteRevocation: CalendarRemoteRevocationOutcome;
};

export type CalendarDurableReceipt = {
  durable: true;
  eventId: string;
  htmlLink: string | null;
  expiresAt: string | null;
};

export type CalendarTurnState = {
  operationId: string;
  state: CalendarOperationState;
  narration: CalendarNarrationStatus;
  retryAction: CalendarRetryAction;
  receipt: CalendarDurableReceipt | null;
};

export type CalendarProgressEvent = {
  type: 'calendar-progress';
  phase: CalendarProgressPhase;
};

export type CalendarOperationWireEvent = {
  type: 'calendar-operation';
  operation: CalendarTurnState;
};

export type CalendarStreamEvent =
  | StreamEvent
  | CalendarProgressEvent
  | CalendarOperationWireEvent;

export type CalendarStreamEnvelope = {
  protocolVersion: 2;
  sessionId: string;
  turnId: string;
  attemptId: string;
  sequence: number;
  event: CalendarStreamEvent;
};

export type CalendarCompatibleEnvelope = StreamEnvelope | CalendarStreamEnvelope;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_CALENDAR_HOSTS = new Set(['www.google.com', 'calendar.google.com', 'google.com']);
const SCRUBBED_QUERY_KEYS = new Set([
  'plugin',
  'oauth',
  'code',
  'state',
  'scope',
  'error',
  'error_description',
  'error_uri',
  'iss',
  'authuser',
  'prompt',
  'hd',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'token',
  'userId',
  'calendarId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    !CONTROL_CHARS.test(value)
  );
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isSafeGoogleOAuthUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === 'https://accounts.google.com' &&
      parsed.pathname === '/o/oauth2/v2/auth' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function isSafeCalendarEventLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      SAFE_CALENDAR_HOSTS.has(parsed.hostname) &&
      parsed.pathname === '/calendar/event'
    );
  } catch {
    return false;
  }
}

function isProcessingDisclosure(value: unknown): value is CalendarProcessingDisclosure {
  if (!isRecord(value) || !hasExactKeys(value, ['policyId', 'processors', 'dataCollection'])) {
    return false;
  }
  return (
    isBoundedId(value.policyId) &&
    value.processors === 'Google, OpenRouter and the configured model provider' &&
    value.dataCollection === 'deny'
  );
}

export function isCalendarPublicStatus(value: unknown): value is CalendarPublicStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'state',
      'enabled',
      'accountEmail',
      'targetCalendarId',
      'processingDisclosure',
    ])
  ) {
    return false;
  }
  const stateOk =
    typeof value.state === 'string' &&
    (CALENDAR_CONNECTION_STATES as readonly string[]).includes(value.state);
  const emailOk =
    value.accountEmail === null ||
    (typeof value.accountEmail === 'string' &&
      value.accountEmail.length >= 3 &&
      value.accountEmail.length <= 320 &&
      !CONTROL_CHARS.test(value.accountEmail) &&
      EMAIL_PATTERN.test(value.accountEmail));
  const targetOk =
    value.targetCalendarId === null ||
    (typeof value.targetCalendarId === 'string' &&
      value.targetCalendarId.length >= 1 &&
      value.targetCalendarId.length <= 1024 &&
      !CONTROL_CHARS.test(value.targetCalendarId));
  const disclosureOk =
    value.processingDisclosure === null || isProcessingDisclosure(value.processingDisclosure);

  return (
    value.protocolVersion === CALENDAR_PROTOCOL_VERSION &&
    stateOk &&
    typeof value.enabled === 'boolean' &&
    emailOk &&
    targetOk &&
    disclosureOk
  );
}

export function isCalendarSettingsRequest(value: unknown): value is CalendarSettingsRequest {
  return isRecord(value) && hasExactKeys(value, ['enabled']) && typeof value.enabled === 'boolean';
}

export function isCalendarOAuthStartRequest(value: unknown): value is CalendarOAuthStartRequest {
  return isRecord(value) && Object.keys(value).length === 0;
}

export function isCalendarOAuthStartResponse(value: unknown): value is CalendarOAuthStartResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['authorizationUrl']) &&
    isSafeGoogleOAuthUrl(value.authorizationUrl)
  );
}

export function isCalendarDisconnectRequest(value: unknown): value is CalendarDisconnectRequest {
  if (!isRecord(value) || typeof value.mode !== 'string') {
    return false;
  }
  if (value.mode === 'local') {
    return hasExactKeys(value, ['mode']);
  }
  if (value.mode === 'revoke-google-grant') {
    return (
      hasExactKeys(value, ['mode', 'acknowledgeProjectWideRevocation']) &&
      value.acknowledgeProjectWideRevocation === true
    );
  }
  return false;
}

export function isCalendarDisconnectResponse(value: unknown): value is CalendarDisconnectResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['disconnected', 'remoteRevocation']) &&
    value.disconnected === true &&
    typeof value.remoteRevocation === 'string' &&
    (CALENDAR_REMOTE_REVOCATION_OUTCOMES as readonly string[]).includes(value.remoteRevocation)
  );
}

function isCalendarDurableReceipt(value: unknown): value is CalendarDurableReceipt {
  if (!isRecord(value) || !hasExactKeys(value, ['durable', 'eventId', 'htmlLink', 'expiresAt'])) {
    return false;
  }
  const eventIdOk =
    typeof value.eventId === 'string' &&
    value.eventId.length >= 5 &&
    value.eventId.length <= 1024 &&
    !CONTROL_CHARS.test(value.eventId);
  const linkOk = value.htmlLink === null || isSafeCalendarEventLink(value.htmlLink);
  const expiresOk = value.expiresAt === null || isIsoDate(value.expiresAt);
  if (!value.durable || value.durable !== true || !eventIdOk || !linkOk || !expiresOk) {
    return false;
  }
  return value.htmlLink === null || value.expiresAt !== null;
}

export function isCalendarTurnState(value: unknown): value is CalendarTurnState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['operationId', 'state', 'narration', 'retryAction', 'receipt'])
  ) {
    return false;
  }
  const stateOk =
    typeof value.state === 'string' &&
    (CALENDAR_OPERATION_STATES as readonly string[]).includes(value.state);
  const narrationOk =
    typeof value.narration === 'string' &&
    (CALENDAR_NARRATION_STATUSES as readonly string[]).includes(value.narration);
  const retryOk =
    typeof value.retryAction === 'string' &&
    (CALENDAR_RETRY_ACTIONS as readonly string[]).includes(value.retryAction);
  const receiptOk = value.receipt === null || isCalendarDurableReceipt(value.receipt);
  if (!isBoundedId(value.operationId) || !stateOk || !narrationOk || !retryOk || !receiptOk) {
    return false;
  }
  return (value.state === 'succeeded') === (value.receipt !== null);
}

export function isCalendarProgressEvent(value: unknown): value is CalendarProgressEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'phase']) &&
    value.type === 'calendar-progress' &&
    typeof value.phase === 'string' &&
    (CALENDAR_PROGRESS_PHASES as readonly string[]).includes(value.phase)
  );
}

export function isCalendarOperationWireEvent(value: unknown): value is CalendarOperationWireEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'operation']) &&
    value.type === 'calendar-operation' &&
    isCalendarTurnState(value.operation)
  );
}

export function isCalendarStreamEvent(value: unknown): value is CalendarStreamEvent {
  return (
    isStreamEvent(value) ||
    isCalendarProgressEvent(value) ||
    isCalendarOperationWireEvent(value)
  );
}

export function isCalendarStreamEnvelope(value: unknown): value is CalendarStreamEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'sessionId',
      'turnId',
      'attemptId',
      'sequence',
      'event',
    ])
  ) {
    return false;
  }
  return (
    value.protocolVersion === CALENDAR_STREAM_PROTOCOL_VERSION &&
    isBoundedId(value.sessionId) &&
    isBoundedId(value.turnId) &&
    isBoundedId(value.attemptId) &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isCalendarStreamEvent(value.event)
  );
}

export function isCalendarCompatibleEnvelope(value: unknown): value is CalendarCompatibleEnvelope {
  return isStreamEnvelope(value) || isCalendarStreamEnvelope(value);
}

export function parseCalendarCompatibleFrame(line: string): CalendarCompatibleEnvelope {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice('data:'.length).trim());
  } catch {
    throw new Error('invalid_stream_envelope');
  }
  if (!isCalendarCompatibleEnvelope(parsed)) {
    throw new Error('invalid_stream_envelope');
  }
  return parsed;
}

export function extractAndScrubCalendarOAuthCallback(currentHref: string): {
  outcome: CalendarOAuthCallbackOutcome | null;
  scrubbedPathAndSearch: string;
  hadSensitiveParams: boolean;
} {
  let url: URL;
  try {
    url = new URL(currentHref, 'http://127.0.0.1:5173');
  } catch {
    return { outcome: null, scrubbedPathAndSearch: '/', hadSensitiveParams: false };
  }

  const plugin = url.searchParams.get('plugin');
  const rawOAuth = url.searchParams.get('oauth');
  const outcome: CalendarOAuthCallbackOutcome | null =
    plugin === 'google-calendar' &&
    rawOAuth !== null &&
    (CALENDAR_OAUTH_CALLBACK_OUTCOMES as readonly string[]).includes(rawOAuth)
      ? (rawOAuth as CalendarOAuthCallbackOutcome)
      : null;

  let hadSensitiveParams = false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (SCRUBBED_QUERY_KEYS.has(key)) {
      url.searchParams.delete(key);
      hadSensitiveParams = true;
    }
  }

  if (url.hash) {
    const lowerHash = url.hash.toLowerCase();
    if (
      lowerHash.includes('token') ||
      lowerHash.includes('code') ||
      lowerHash.includes('state') ||
      lowerHash.includes('error') ||
      outcome !== null
    ) {
      url.hash = '';
      hadSensitiveParams = true;
    }
  }

  const search = url.searchParams.toString();
  const scrubbedPathAndSearch = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  return { outcome, scrubbedPathAndSearch, hadSensitiveParams };
}
```

Update `frontend/src/api/protocol.ts` to support `calendarProtocol?: 2`, `TurnStatusResponse.calendar`, `isStreamEvent` export, `isRetryTurnRequest`, `isTurnStatusResponse`, and Calendar override rejection:

```typescript
import {
  isCalendarTurnState,
  type CalendarTurnState,
} from './calendar-protocol.ts'

export const STREAM_PROTOCOL_VERSION = 1
export const API_PROTOCOL_VERSION = 1

export const API_ROUTES = {
  sessions: '/sessions',
  session: (sessionId: string) => `/sessions/${sessionId}`,
  messages: (sessionId: string) => `/sessions/${sessionId}/messages`,
  turns: (sessionId: string) => `/sessions/${sessionId}/turns`,
  turnStatus: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}`,
  turnStream: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/stream`,
  cancelTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/cancel`,
  retryTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/retry`,
} as const

export const ATTEMPT_STATUSES = [
  'accepted',
  'generating',
  'finalizing',
  'completed',
  'truncated',
  'failed',
  'cancelled',
  'interrupted',
] as const

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number]

export type ClientErrorBody = {
  code: string
  message: string
  retryable: boolean
}

export type SubmitTurnRequest = {
  sessionId: string | null
  content: string
  idempotencyKey: string
  calendarProtocol?: 2
}

export type SubmitTurnResponse = {
  sessionId: string
  turnId: string
  attemptId: string
  userMessageId: string
  streamPath: string
}

export type RetryTurnRequest = {
  idempotencyKey: string
  calendarProtocol?: 2
}

export type SessionSummary = {
  pinned?: boolean
  sessionId: string
  title: string
  createdAt: string
  lastActivityAt: string
}

export type ListSessionsResponse = {
  items: SessionSummary[]
  nextCursor: string | null
}

export type VoiceTranscriptItem = {
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

export type VisibleMessage = {
  messageId: string
  turnId: string
  eventId: string
  sequence: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  completionStatus:
    | 'accepted'
    | 'streaming'
    | 'completed'
    | 'truncated'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
  truncated: boolean
  visibility?: 'visible' | 'internal'
  mode?: 'text' | 'live'
  voiceSessionId?: string
  voiceDurationSeconds?: number
  voiceTranscripts?: VoiceTranscriptItem[]
}

export type ListMessagesResponse = {
  items: VisibleMessage[]
  nextCursor: string | null
  olderAvailable: boolean
}

export type TurnStatusResponse = {
  sessionId: string
  turnId: string
  attemptId: string
  status: AttemptStatus
  truncated: boolean
  error: ClientErrorBody | null
  calendar?: CalendarTurnState
}

export type StreamEvent =
  | { type: 'turn-accepted'; userMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; status: AttemptStatus; truncated: boolean }
  | {
      type: 'usage'
      accountingStatus: 'known' | 'pending' | 'unknown'
      promptTokens: number | null
      completionTokens: number | null
      cost: number | null
    }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | {
      type: 'completed'
      assistantMessageId: string
      outcome: 'completed' | 'truncated'
    }

export type StreamEnvelope = {
  protocolVersion: 1
  sessionId: string
  turnId: string
  attemptId: string
  sequence: number
  event: StreamEvent
}

const OVERRIDE_KEYS = [
  'userId',
  'user',
  'openRouterUser',
  'model',
  'modelId',
  'apiKey',
  'calendarId',
  'accountId',
  'connectionId',
  'googleSubjectId',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'authorization',
  'serviceUrl',
] as const

const APP_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNKNOWN_FIELD',
  'IDENTITY_OVERRIDE_REJECTED',
  'MODEL_OVERRIDE_REJECTED',
  'NOT_FOUND',
  'CONFLICT_ACTIVE_TURN',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'CONTEXT_BUDGET_EXCEEDED',
  'INPUT_TOO_LARGE',
  'STORAGE_BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'CONCURRENCY_LIMIT',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PROVIDER_AUTH',
  'PROVIDER_CREDITS',
  'CANCELLED',
  'INTERRUPTED',
  'PERSISTENCE_ERROR',
  'CONFIGURATION_ERROR',
  'NOT_READY',
  'UNSUPPORTED_TOPOLOGY',
] as const

const OVERRIDE_MESSAGE = 'Identity, model, and API keys cannot be supplied by the client.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.includes(key))
  )
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128
}

function isAttemptStatus(value: unknown): value is AttemptStatus {
  return (
    typeof value === 'string' &&
    (ATTEMPT_STATUSES as readonly string[]).includes(value)
  )
}

function isNullableNonnegativeInteger(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
}

function isNullableNonnegativeNumber(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
}

function isAppErrorCode(value: unknown): value is (typeof APP_ERROR_CODES)[number] {
  return (
    typeof value === 'string' &&
    (APP_ERROR_CODES as readonly string[]).includes(value)
  )
}

export function assertNoClientOverrides(body: unknown): void {
  if (!isRecord(body)) {
    return
  }

  for (const key of OVERRIDE_KEYS) {
    if (key in body) {
      throw new Error(OVERRIDE_MESSAGE)
    }
  }
}

export function isSubmitTurnRequest(body: unknown): body is SubmitTurnRequest {
  if (!isRecord(body)) {
    return false
  }
  const allowedWithoutProtocol = hasExactKeys(body, ['sessionId', 'content', 'idempotencyKey'])
  const allowedWithProtocol =
    hasExactKeys(body, ['sessionId', 'content', 'idempotencyKey', 'calendarProtocol']) &&
    body.calendarProtocol === 2
  if (!allowedWithoutProtocol && !allowedWithProtocol) {
    return false
  }

  const sessionOk = body.sessionId === null || isBoundedId(body.sessionId)
  return (
    sessionOk &&
    typeof body.content === 'string' &&
    body.content.length > 0 &&
    body.content.length <= 32_000 &&
    typeof body.idempotencyKey === 'string' &&
    body.idempotencyKey.length >= 8 &&
    body.idempotencyKey.length <= 128
  )
}

export function isRetryTurnRequest(body: unknown): body is RetryTurnRequest {
  if (!isRecord(body)) {
    return false
  }
  const allowedWithoutProtocol = hasExactKeys(body, ['idempotencyKey'])
  const allowedWithProtocol =
    hasExactKeys(body, ['idempotencyKey', 'calendarProtocol']) &&
    body.calendarProtocol === 2
  if (!allowedWithoutProtocol && !allowedWithProtocol) {
    return false
  }
  return (
    typeof body.idempotencyKey === 'string' &&
    body.idempotencyKey.length >= 8 &&
    body.idempotencyKey.length <= 128
  )
}

export function isTurnStatusResponse(value: unknown): value is TurnStatusResponse {
  if (!isRecord(value)) {
    return false
  }
  const baseKeys = ['sessionId', 'turnId', 'attemptId', 'status', 'truncated', 'error'] as const
  const hasBase = hasExactKeys(value, baseKeys)
  const hasCalendar =
    hasExactKeys(value, [...baseKeys, 'calendar']) && isCalendarTurnState(value.calendar)
  if (!hasBase && !hasCalendar) {
    return false
  }
  const errorOk =
    value.error === null ||
    (isRecord(value.error) &&
      hasExactKeys(value.error, ['code', 'message', 'retryable']) &&
      isAppErrorCode(value.error.code) &&
      typeof value.error.message === 'string' &&
      value.error.message.length > 0 &&
      value.error.message.length <= 500 &&
      typeof value.error.retryable === 'boolean')

  return (
    isBoundedId(value.sessionId) &&
    isBoundedId(value.turnId) &&
    isBoundedId(value.attemptId) &&
    isAttemptStatus(value.status) &&
    typeof value.truncated === 'boolean' &&
    errorOk
  )
}

export function isStreamEvent(value: unknown): value is StreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  switch (value.type) {
    case 'turn-accepted':
      return hasExactKeys(value, ['type', 'userMessageId']) && isBoundedId(value.userMessageId)
    case 'delta':
      return hasExactKeys(value, ['type', 'text']) && typeof value.text === 'string' && value.text.length > 0
    case 'status':
      return (
        hasExactKeys(value, ['type', 'status', 'truncated']) &&
        isAttemptStatus(value.status) &&
        typeof value.truncated === 'boolean'
      )
    case 'usage':
      return (
        hasExactKeys(value, [
          'type',
          'accountingStatus',
          'promptTokens',
          'completionTokens',
          'cost',
        ]) &&
        (value.accountingStatus === 'known' ||
          value.accountingStatus === 'pending' ||
          value.accountingStatus === 'unknown') &&
        isNullableNonnegativeInteger(value.promptTokens) &&
        isNullableNonnegativeInteger(value.completionTokens) &&
        isNullableNonnegativeNumber(value.cost)
      )
    case 'error':
      return (
        hasExactKeys(value, ['type', 'code', 'message', 'retryable']) &&
        isAppErrorCode(value.code) &&
        typeof value.message === 'string' &&
        value.message.length > 0 &&
        value.message.length <= 500 &&
        typeof value.retryable === 'boolean'
      )
    case 'completed':
      return (
        hasExactKeys(value, ['type', 'assistantMessageId', 'outcome']) &&
        isBoundedId(value.assistantMessageId) &&
        (value.outcome === 'completed' || value.outcome === 'truncated')
      )
    default:
      return false
  }
}

export function isStreamEnvelope(value: unknown): value is StreamEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'sessionId',
      'turnId',
      'attemptId',
      'sequence',
      'event',
    ])
  ) {
    return false
  }

  return (
    value.protocolVersion === STREAM_PROTOCOL_VERSION &&
    isBoundedId(value.sessionId) &&
    isBoundedId(value.turnId) &&
    isBoundedId(value.attemptId) &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isStreamEvent(value.event)
  )
}

export function parseSseDataLine(line: string): StreamEnvelope {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice('data:'.length).trim())
  } catch {
    throw new Error('invalid_stream_envelope')
  }

  if (!isStreamEnvelope(parsed)) {
    throw new Error('invalid_stream_envelope')
  }
  return parsed
}
```

- [ ] **Step 4: Run the protocol test suites to verify they pass**

Run from `frontend/`:
```powershell
npm test -- src/api/calendar-protocol.test.ts src/api/protocol.test.ts
```
Expected: PASS (all tests in `calendar-protocol.test.ts` and `protocol.test.ts` pass).

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/api/calendar-protocol.ts" "frontend/src/api/calendar-protocol.test.ts" "frontend/src/api/protocol.ts" "frontend/src/api/protocol.test.ts"
git commit -m "feat(frontend): mirror P1 calendar wire contracts and URL scrubbing"
```

---

### Task 2: Implement `CalendarClient` and Extend `ApiClient` for Protocol v2 Streams

**Files:**
- Create: `frontend/src/api/calendar-client.ts`
- Create: `frontend/src/api/calendar-client.test.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests in `frontend/src/api/calendar-client.test.ts` and `frontend/src/api/client.test.ts`**

Create `frontend/src/api/calendar-client.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { CalendarClientError, createCalendarClient } from './calendar-client.ts';
import { CALENDAR_CSRF_HEADER, CALENDAR_CSRF_VALUE } from './calendar-protocol.ts';

const validStatus = {
  protocolVersion: 1 as const,
  state: 'connected' as const,
  enabled: true,
  accountEmail: 'operator@example.com',
  targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
  processingDisclosure: {
    policyId: 'policy-1',
    processors: 'Google, OpenRouter and the configured model provider' as const,
    dataCollection: 'deny' as const,
  },
};

describe('CalendarClient', () => {
  it('reads status with no-store and no query string', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(validStatus));
    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    const status = await client.getStatus();
    expect(status).toEqual(validStatus);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/plugins/google-calendar/status',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
      }),
    );
  });

  it('sends CSRF header and strict JSON body on settings, oauthStart, and disconnect', async () => {
    const oauthUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s1';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...validStatus, enabled: false, state: 'disabled' }))
      .mockResolvedValueOnce(Response.json({ authorizationUrl: oauthUrl }))
      .mockResolvedValueOnce(
        Response.json({ disconnected: true, remoteRevocation: 'confirmed' }),
      );

    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    const updated = await client.updateSettings({ enabled: false });
    expect(updated.enabled).toBe(false);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/plugins/google-calendar/settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: JSON.stringify({ enabled: false }),
      }),
    );

    const started = await client.startOAuth();
    expect(started.authorizationUrl).toBe(oauthUrl);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/plugins/google-calendar/oauth/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: '{}',
      }),
    );

    const disconnected = await client.disconnect({
      mode: 'revoke-google-grant',
      acknowledgeProjectWideRevocation: true,
    });
    expect(disconnected).toEqual({ disconnected: true, remoteRevocation: 'confirmed' });
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      '/api/plugins/google-calendar/disconnect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: JSON.stringify({
          mode: 'revoke-google-grant',
          acknowledgeProjectWideRevocation: true,
        }),
      }),
    );
  });

  it('rejects unsafe OAuth URLs and maps server errors to safe CalendarClientError instances', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ authorizationUrl: 'https://evil.example.com/o/oauth2/v2/auth' }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 'CONFLICT_ACTIVE_TURN',
            message: 'Another Calendar setup change is already in progress.',
            retryable: false,
          },
          { status: 409 },
        ),
      );

    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    await expect(client.startOAuth()).rejects.toBeInstanceOf(CalendarClientError);
    await expect(client.updateSettings({ enabled: true })).rejects.toMatchObject({
      name: 'CalendarClientError',
      code: 'CONFLICT_ACTIVE_TURN',
      status: 409,
    });
  });
});
```

Append a test to `frontend/src/api/client.test.ts` inside `describe('ApiClient SSE Stream Consumer', ...)`:

```typescript
  it('parses protocolVersion 2 calendar-progress and calendar-operation stream frames', async () => {
    const ssePayload = [
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"calendar-progress","phase":"repairing"}}\n\n',
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":2,"event":{"type":"calendar-operation","operation":{"operationId":"op_1","state":"succeeded","narration":"pending","retryAction":"none","receipt":{"durable":true,"eventId":"evt_12345","htmlLink":"https://www.google.com/calendar/event?eid=123","expiresAt":"2026-10-22T00:00:00.000Z"}}}}\n\n',
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":3,"event":{"type":"completed","assistantMessageId":"msg_ast_1","outcome":"completed"}}\n\n',
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: makeReadableStream(ssePayload),
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const events: string[] = [];

    await client.connectTurnStream('/sessions/sess_1/turns/turn_1/stream', {
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual(['calendar-progress', 'calendar-operation', 'completed']);
  });
```

- [ ] **Step 2: Run the client test suites to verify they fail**

Run from `frontend/`:
```powershell
npm test -- src/api/calendar-client.test.ts src/api/client.test.ts
```
Expected: FAIL because `frontend/src/api/calendar-client.ts` does not exist yet and `ApiClient.connectTurnStream` still rejects `protocolVersion: 2`.

- [ ] **Step 3: Implement `frontend/src/api/calendar-client.ts` and update `frontend/src/api/client.ts`**

Create `frontend/src/api/calendar-client.ts`:

```typescript
import {
  CALENDAR_API_ROUTES,
  CALENDAR_CSRF_HEADER,
  CALENDAR_CSRF_VALUE,
  isCalendarDisconnectRequest,
  isCalendarDisconnectResponse,
  isCalendarOAuthStartResponse,
  isCalendarPublicStatus,
  isCalendarSettingsRequest,
  type CalendarDisconnectRequest,
  type CalendarDisconnectResponse,
  type CalendarOAuthStartResponse,
  type CalendarPublicStatus,
  type CalendarSettingsRequest,
} from './calendar-protocol.ts';
import { assertNoClientOverrides } from './protocol.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16_384;
const DEFAULT_ERROR_MESSAGE = 'Calendar setup request could not be completed.';

export class CalendarClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly uncertain: boolean;

  constructor(options: {
    code: string;
    message?: string;
    status?: number;
    retryable?: boolean;
    uncertain?: boolean;
  }) {
    super(options.message ?? DEFAULT_ERROR_MESSAGE);
    this.name = 'CalendarClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.uncertain = options.uncertain ?? false;
  }
}

export type CalendarClient = {
  getStatus(signal?: AbortSignal): Promise<CalendarPublicStatus>;
  updateSettings(
    request: CalendarSettingsRequest,
    signal?: AbortSignal,
  ): Promise<CalendarPublicStatus>;
  startOAuth(signal?: AbortSignal): Promise<CalendarOAuthStartResponse>;
  disconnect(
    request: CalendarDisconnectRequest,
    signal?: AbortSignal,
  ): Promise<CalendarDisconnectResponse>;
};

function readViteApiBase(): string | undefined {
  try {
    const env = import.meta.env as { VITE_API_BASE?: string } | undefined;
    return env?.VITE_API_BASE;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    return response.json();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CalendarClientError({
        code: 'INVALID_CALENDAR_RESPONSE',
        status: response.status,
      });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
  return JSON.parse(text) as unknown;
}

export function createCalendarClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): CalendarClient {
  const baseUrl = (options?.baseUrl ?? readViteApiBase() ?? '/api').replace(/\/+$/, '');
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);

  async function send<T>(
    method: 'GET' | 'PATCH' | 'POST',
    path: string,
    body: unknown,
    validate: (payload: unknown) => payload is T,
    signal?: AbortSignal,
  ): Promise<T> {
    const mutation = method !== 'GET';
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (mutation) {
        headers['Content-Type'] = 'application/json';
        headers[CALENDAR_CSRF_HEADER] = CALENDAR_CSRF_VALUE;
      }

      const response = await fetcher(`${baseUrl}${path}`, {
        method,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers,
        body: mutation ? JSON.stringify(body ?? {}) : undefined,
        signal: combined,
      });

      let payload: unknown;
      try {
        payload = await readBoundedJson(response);
      } catch {
        throw new CalendarClientError({
          code: 'INVALID_CALENDAR_RESPONSE',
          status: response.status,
          uncertain: mutation,
        });
      }

      if (!response.ok) {
        const record =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : null;
        const code = typeof record?.code === 'string' ? record.code : `HTTP_${response.status}`;
        const message =
          typeof record?.message === 'string' && record.message.length <= 500
            ? record.message
            : DEFAULT_ERROR_MESSAGE;
        const retryable =
          typeof record?.retryable === 'boolean'
            ? record.retryable
            : response.status >= 500 || response.status === 429;
        throw new CalendarClientError({
          code,
          message,
          status: response.status,
          retryable,
        });
      }

      if (!validate(payload)) {
        throw new CalendarClientError({
          code: 'INVALID_CALENDAR_RESPONSE',
          status: response.status,
          uncertain: mutation,
        });
      }

      return payload;
    } catch (err: unknown) {
      if (err instanceof CalendarClientError) {
        throw err;
      }
      const isAbort =
        combined.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (isAbort && signal?.aborted && !timeout.signal.aborted) {
        throw new CalendarClientError({
          code: 'ABORTED',
          message: 'Calendar request was cancelled.',
          retryable: false,
          uncertain: mutation,
        });
      }
      if (isAbort && timeout.signal.aborted) {
        throw new CalendarClientError({
          code: 'TIMEOUT',
          message: 'Calendar setup timed out.',
          retryable: true,
          uncertain: mutation,
        });
      }
      throw new CalendarClientError({
        code: 'NETWORK_ERROR',
        message: 'Calendar setup request failed.',
        retryable: true,
        uncertain: mutation,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getStatus(signal) {
      return send('GET', CALENDAR_API_ROUTES.status, undefined, isCalendarPublicStatus, signal);
    },
    async updateSettings(request, signal) {
      assertNoClientOverrides(request);
      if (!isCalendarSettingsRequest(request)) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      return send('PATCH', CALENDAR_API_ROUTES.settings, request, isCalendarPublicStatus, signal);
    },
    async startOAuth(signal) {
      return send(
        'POST',
        CALENDAR_API_ROUTES.oauthStart,
        {},
        isCalendarOAuthStartResponse,
        signal,
      );
    },
    async disconnect(request, signal) {
      assertNoClientOverrides(request);
      if (!isCalendarDisconnectRequest(request)) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      return send(
        'POST',
        CALENDAR_API_ROUTES.disconnect,
        request,
        isCalendarDisconnectResponse,
        signal,
      );
    },
  };
}
```

Update `frontend/src/api/client.ts` to parse v1/v2 frames via `parseCalendarCompatibleFrame` and validate `isRetryTurnRequest`:

```typescript
import {
  parseCalendarCompatibleFrame,
  type CalendarCompatibleEnvelope,
  type CalendarStreamEvent,
} from './calendar-protocol.ts';
import {
  API_ROUTES,
  assertNoClientOverrides,
  isRetryTurnRequest,
  isSubmitTurnRequest,
  type ListMessagesResponse,
  type ListSessionsResponse,
  type RetryTurnRequest,
  type SessionSummary,
  type SubmitTurnRequest,
  type SubmitTurnResponse,
  type TurnStatusResponse,
} from './protocol.ts';
```

In `frontend/src/api/client.ts`, update `StreamHandlers`, `retryTurn`, and `connectTurnStream`'s frame parser:

```typescript
export type StreamHandlers = {
  onEnvelope?: (envelope: CalendarCompatibleEnvelope) => void;
  onEvent?: (event: CalendarStreamEvent, envelope: CalendarCompatibleEnvelope) => void;
  onComplete?: (outcome: 'completed' | 'truncated') => void;
  onError?: (error: ApiClientError) => void;
  signal?: AbortSignal;
};
```

In `retryTurn` (`frontend/src/api/client.ts`):
```typescript
  async retryTurn(
    sessionId: string,
    turnId: string,
    request: RetryTurnRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SubmitTurnResponse> {
    assertNoClientOverrides(request);
    if (!isRetryTurnRequest(request)) {
      throw new ApiClientError('INVALID_REQUEST', 'Request does not match RetryTurnRequest contract', 400, false);
    }
    return this.request<SubmitTurnResponse>(API_ROUTES.retryTurn(sessionId, turnId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options?.signal,
    });
  }
```

And in `connectTurnStream` (`frontend/src/api/client.ts`), replace `let envelope: StreamEnvelope; try { envelope = parseSseDataLine(trimmed); }` with:
```typescript
          if (trimmed.startsWith('data:')) {
            let envelope: CalendarCompatibleEnvelope;
            try {
              envelope = parseCalendarCompatibleFrame(trimmed);
            } catch (parseErr) {
              const apiErr = new ApiClientError(
                'INVALID_STREAM_ENVELOPE',
                parseErr instanceof Error ? parseErr.message : 'Invalid envelope received',
                200,
                false,
              );
              handlers.onError?.(apiErr);
              continue;
            }
```

- [ ] **Step 4: Run the client test suites to verify they pass**

Run from `frontend/`:
```powershell
npm test -- src/api/calendar-client.test.ts src/api/client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/api/calendar-client.ts" "frontend/src/api/calendar-client.test.ts" "frontend/src/api/client.ts" "frontend/src/api/client.test.ts"
git commit -m "feat(frontend): add CalendarClient and v2 SSE stream compatibility"
```

---

### Task 3: Implement Pure Setup State Machine and `GoogleCalendarPanel` Component

**Files:**
- Create: `frontend/src/features/plugins/google-calendar/calendar-setup-state.ts`
- Create: `frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts`
- Create: `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx`
- Create: `frontend/src/features/plugins/google-calendar/google-calendar-panel.test.ts`
- Create: `frontend/src/features/plugins/google-calendar/calendar-plugin.css`

- [ ] **Step 1: Write the failing unit and SSR tests in `calendar-setup-state.test.ts` and `google-calendar-panel.test.ts`**

Create `frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  describeConnectionState,
  describeOAuthOutcome,
  describeRemoteRevocation,
  navigateToGoogleOAuth,
} from './calendar-setup-state.ts';

describe('calendar-setup-state', () => {
  it('distinguishes disabled, setup-required, connected, reconnect-required, and degraded states', () => {
    expect(describeConnectionState('disabled').badge).toBe('Disabled (default off)');
    expect(describeConnectionState('setup-required').badge).toBe('Setup required');
    expect(describeConnectionState('connected').badge).toBe('Connected');
    expect(describeConnectionState('reconnect-required').badge).toBe('Reconnect required');
    expect(describeConnectionState('degraded').badge).toBe('Degraded (fixture or limited readiness)');
  });

  it('distinguishes fixture OAuth callback outcomes from real connected Google grants', () => {
    expect(describeOAuthOutcome('connected')).toContain('Google Calendar connected');
    expect(describeOAuthOutcome('fixture')).toContain('local fixture mode');
    expect(describeOAuthOutcome('fixture')).toContain('not a live Google grant');
    expect(describeOAuthOutcome('cancelled')).toContain('cancelled');
    expect(describeOAuthOutcome('failed')).toContain('could not be completed');
  });

  it('requires explicit project-wide revocation acknowledgment before revoke-google-grant', () => {
    let state = createInitialCalendarSetupState();
    state = calendarSetupReducer(state, { type: 'openDisconnect', mode: 'revoke-google-grant' });
    expect(state.disconnectPrompt).toEqual({
      mode: 'revoke-google-grant',
      acknowledgedProjectWide: false,
    });

    state = calendarSetupReducer(state, { type: 'setRevokeAcknowledged', acknowledged: true });
    expect(state.disconnectPrompt?.acknowledgedProjectWide).toBe(true);
  });

  it('navigates only to verified Google OAuth URLs and refuses unsafe targets', () => {
    const navigate = vi.fn();
    const safeUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s1';
    expect(navigateToGoogleOAuth(safeUrl, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(safeUrl);

    const unsafeNavigate = vi.fn();
    expect(navigateToGoogleOAuth('javascript:alert(1)', unsafeNavigate)).toBe(false);
    expect(navigateToGoogleOAuth('https://evil.example.com/o/oauth2/v2/auth', unsafeNavigate)).toBe(
      false,
    );
    expect(unsafeNavigate).not.toHaveBeenCalled();
  });

  it('describes remote revocation outcomes without promising automatic background retry', () => {
    expect(describeRemoteRevocation('not-requested')).toContain('Disconnected locally');
    expect(describeRemoteRevocation('confirmed')).toContain('confirmed Google grant revocation');
    expect(describeRemoteRevocation('failed')).toContain('Google Account permissions');
    expect(describeRemoteRevocation('unknown')).toContain('could not be confirmed');
  });
});
```

Create `frontend/src/features/plugins/google-calendar/google-calendar-panel.test.ts`:

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarClient } from '../../../api/calendar-client.ts';
import type { CalendarPublicStatus } from '../../../api/calendar-protocol.ts';
import { GoogleCalendarPanel } from './GoogleCalendarPanel.tsx';

function mockClient(status: CalendarPublicStatus): CalendarClient {
  return {
    getStatus: vi.fn(async () => status),
    updateSettings: vi.fn(async () => status),
    startOAuth: vi.fn(async () => ({
      authorizationUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s',
    })),
    disconnect: vi.fn(async () => ({ disconnected: true as const, remoteRevocation: 'not-requested' as const })),
  };
}

const baseStatus: CalendarPublicStatus = {
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

describe('GoogleCalendarPanel SSR markup', () => {
  it('renders default-off disabled state, local single-user disclosure, target calendar ID, and enable action', () => {
    const html = renderToStaticMarkup(
      createElement(GoogleCalendarPanel, {
        client: mockClient(baseStatus),
        initialStatus: baseStatus,
      }),
    );
    expect(html).toContain('Disabled (default off)');
    expect(html).toContain('disposable-test@group.calendar.google.com');
    expect(html).toContain('Google, OpenRouter and the configured model provider');
    expect(html).toContain('Enable Google Calendar');
    expect(html).toContain('Single-user local proof');
  });

  it('renders connected state with account email, target calendar ID, disable, and both disconnect options', () => {
    const connected: CalendarPublicStatus = {
      ...baseStatus,
      state: 'connected',
      enabled: true,
      accountEmail: 'operator@example.com',
    };
    const html = renderToStaticMarkup(
      createElement(GoogleCalendarPanel, {
        client: mockClient(connected),
        initialStatus: connected,
        initialDisconnectMode: 'revoke-google-grant',
      }),
    );
    expect(html).toContain('Connected');
    expect(html).toContain('operator@example.com');
    expect(html).toContain('disposable-test@group.calendar.google.com');
    expect(html).toContain('Disable Google Calendar');
    expect(html).toContain('Project-wide implication');
    expect(html).toContain('I understand this revokes the Google grant across this OAuth project');
  });

  it('renders reconnect-required state and fixture OAuth callback banner without claiming live Google connection', () => {
    const reconnect: CalendarPublicStatus = {
      ...baseStatus,
      state: 'reconnect-required',
      enabled: true,
      accountEmail: 'operator@example.com',
    };
    const html = renderToStaticMarkup(
      createElement(GoogleCalendarPanel, {
        client: mockClient(reconnect),
        initialStatus: reconnect,
        oauthOutcome: 'fixture',
      }),
    );
    expect(html).toContain('Reconnect required');
    expect(html).toContain('Reconnect Google Calendar');
    expect(html).toContain('local fixture mode (not a live Google grant)');
  });
});
```

- [ ] **Step 2: Run the setup state and panel tests to verify they fail**

Run from `frontend/`:
```powershell
npm test -- src/features/plugins/google-calendar/calendar-setup-state.test.ts src/features/plugins/google-calendar/google-calendar-panel.test.ts
```
Expected: FAIL because `calendar-setup-state.ts` and `GoogleCalendarPanel.tsx` do not exist yet.

- [ ] **Step 3: Implement `calendar-setup-state.ts`, `GoogleCalendarPanel.tsx`, and `calendar-plugin.css`**

Create `frontend/src/features/plugins/google-calendar/calendar-setup-state.ts`:

```typescript
import {
  isSafeGoogleOAuthUrl,
  type CalendarConnectionState,
  type CalendarOAuthCallbackOutcome,
  type CalendarPublicStatus,
  type CalendarRemoteRevocationOutcome,
} from '../../../api/calendar-protocol.ts';

export type DisconnectMode = 'local' | 'revoke-google-grant';

export type CalendarSetupState = {
  phase: 'loading' | 'ready' | 'unavailable';
  status: CalendarPublicStatus | null;
  pending: 'enable' | 'disable' | 'oauth-start' | 'disconnect' | null;
  error: string | null;
  notice: string | null;
  disconnectPrompt: {
    mode: DisconnectMode;
    acknowledgedProjectWide: boolean;
  } | null;
};

export type CalendarSetupAction =
  | { type: 'loading' }
  | { type: 'loaded'; status: CalendarPublicStatus }
  | { type: 'unavailable'; message: string }
  | { type: 'begin'; pending: NonNullable<CalendarSetupState['pending']> }
  | { type: 'statusUpdated'; status: CalendarPublicStatus; notice?: string | null }
  | { type: 'failed'; message: string }
  | { type: 'openDisconnect'; mode: DisconnectMode }
  | { type: 'setRevokeAcknowledged'; acknowledged: boolean }
  | { type: 'closeDisconnect' }
  | {
      type: 'disconnected';
      status: CalendarPublicStatus;
      remoteRevocation: CalendarRemoteRevocationOutcome;
    };

export function createInitialCalendarSetupState(
  initialStatus: CalendarPublicStatus | null = null,
  initialDisconnectMode: DisconnectMode | null = null,
): CalendarSetupState {
  return {
    phase: initialStatus ? 'ready' : 'loading',
    status: initialStatus,
    pending: null,
    error: null,
    notice: null,
    disconnectPrompt: initialDisconnectMode
      ? { mode: initialDisconnectMode, acknowledgedProjectWide: false }
      : null,
  };
}

export function describeConnectionState(state: CalendarConnectionState): {
  badge: string;
  summary: string;
} {
  switch (state) {
    case 'disabled':
      return {
        badge: 'Disabled (default off)',
        summary:
          'Google Calendar tools are disabled. Enable the plugin to allow read/create requests on the configured owned calendar.',
      };
    case 'setup-required':
      return {
        badge: 'Setup required',
        summary:
          'Connect the local operator Google account for the server-configured owned target calendar before using Calendar tools.',
      };
    case 'connected':
      return {
        badge: 'Connected',
        summary:
          'Google Calendar is connected and bound to the local server identity and configured target calendar.',
      };
    case 'reconnect-required':
      return {
        badge: 'Reconnect required',
        summary:
          'The Google Calendar grant is missing, expired, or revoked. Pending Calendar operations cannot continue until you reconnect.',
      };
    case 'degraded':
      return {
        badge: 'Degraded (fixture or limited readiness)',
        summary:
          'Google Calendar is running in local fixture or degraded mode rather than a certified live Google connection. Ordinary text chat remains available.',
      };
  }
}

export function describeOAuthOutcome(outcome: CalendarOAuthCallbackOutcome): string {
  switch (outcome) {
    case 'connected':
      return 'Google Calendar connected for the configured target calendar.';
    case 'fixture':
      return 'Google Calendar connected in local fixture mode (not a live Google grant).';
    case 'cancelled':
      return 'Google Calendar authorization was cancelled. No credentials were saved.';
    case 'failed':
      return 'Google Calendar authorization could not be completed. Verify setup and try again.';
  }
}

export function describeRemoteRevocation(outcome: CalendarRemoteRevocationOutcome): string {
  switch (outcome) {
    case 'not-requested':
      return 'Disconnected locally. Stored Aurvin credentials were cleared; your Google project grant was not remotely revoked.';
    case 'confirmed':
      return 'Disconnected locally and confirmed Google grant revocation.';
    case 'failed':
      return 'Disconnected locally and cleared Aurvin credentials, but Google grant revocation failed. Manage or revoke access directly in your Google Account permissions.';
    case 'unknown':
      return 'Disconnected locally and cleared Aurvin credentials, but remote Google grant revocation could not be confirmed. Check your Google Account permissions to verify revocation.';
  }
}

export function navigateToGoogleOAuth(
  authorizationUrl: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): boolean {
  if (!isSafeGoogleOAuthUrl(authorizationUrl)) {
    return false;
  }
  navigate(authorizationUrl);
  return true;
}

export function calendarSetupReducer(
  state: CalendarSetupState,
  action: CalendarSetupAction,
): CalendarSetupState {
  switch (action.type) {
    case 'loading':
      return { ...state, phase: 'loading', error: null };
    case 'loaded':
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
      };
    case 'unavailable':
      return {
        ...state,
        phase: 'unavailable',
        pending: null,
        error: action.message,
      };
    case 'begin':
      return {
        ...state,
        pending: action.pending,
        error: null,
        notice: null,
      };
    case 'statusUpdated':
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
        notice: action.notice ?? null,
      };
    case 'failed':
      return {
        ...state,
        pending: null,
        error: action.message,
      };
    case 'openDisconnect':
      return {
        ...state,
        error: null,
        disconnectPrompt: {
          mode: action.mode,
          acknowledgedProjectWide: false,
        },
      };
    case 'setRevokeAcknowledged':
      if (!state.disconnectPrompt) return state;
      return {
        ...state,
        disconnectPrompt: {
          ...state.disconnectPrompt,
          acknowledgedProjectWide: action.acknowledged,
        },
      };
    case 'closeDisconnect':
      return {
        ...state,
        disconnectPrompt: null,
      };
    case 'disconnected':
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
        disconnectPrompt: null,
        notice: describeRemoteRevocation(action.remoteRevocation),
      };
    default:
      return state;
  }
}
```

Create `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx`:

```tsx
import { useEffect, useId, useReducer, useRef } from 'react';
import { CalendarClientError, type CalendarClient } from '../../../api/calendar-client.ts';
import type {
  CalendarOAuthCallbackOutcome,
  CalendarPublicStatus,
} from '../../../api/calendar-protocol.ts';
import {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  describeConnectionState,
  describeOAuthOutcome,
  navigateToGoogleOAuth,
  type DisconnectMode,
} from './calendar-setup-state.ts';
import './calendar-plugin.css';

export type GoogleCalendarPanelProps = {
  client: CalendarClient;
  initialStatus?: CalendarPublicStatus | null;
  initialDisconnectMode?: DisconnectMode | null;
  oauthOutcome?: CalendarOAuthCallbackOutcome | null;
  onDismissOAuthOutcome?: () => void;
  navigate?: (url: string) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
};

export function GoogleCalendarPanel({
  client,
  initialStatus = null,
  initialDisconnectMode = null,
  oauthOutcome = null,
  onDismissOAuthOutcome,
  navigate,
  disabled = false,
  onBusy,
}: GoogleCalendarPanelProps) {
  const [state, dispatch] = useReducer(
    calendarSetupReducer,
    undefined,
    () => createInitialCalendarSetupState(initialStatus, initialDisconnectMode),
  );
  const inflightRef = useRef(false);
  const localDisconnectBtnRef = useRef<HTMLButtonElement | null>(null);
  const revokeDisconnectBtnRef = useRef<HTMLButtonElement | null>(null);
  const ids = useId();

  useEffect(() => {
    if (initialStatus) return undefined;
    const abort = new AbortController();
    dispatch({ type: 'loading' });
    void client
      .getStatus(abort.signal)
      .then((status) => {
        dispatch({ type: 'loaded', status });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const message =
          err instanceof CalendarClientError
            ? err.message
            : 'Calendar status could not be loaded.';
        dispatch({ type: 'unavailable', message });
      });
    return () => abort.abort();
  }, [client, initialStatus]);

  const setBusy = (busy: boolean) => {
    inflightRef.current = busy;
    onBusy?.(busy);
  };

  const reloadStatus = async () => {
    if (inflightRef.current) return;
    dispatch({ type: 'loading' });
    try {
      const status = await client.getStatus();
      dispatch({ type: 'loaded', status });
    } catch (err: unknown) {
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Calendar status could not be loaded.';
      dispatch({ type: 'unavailable', message });
    }
  };

  const toggleEnabled = async (nextEnabled: boolean) => {
    if (inflightRef.current || disabled) return;
    setBusy(true);
    dispatch({ type: 'begin', pending: nextEnabled ? 'enable' : 'disable' });
    try {
      const status = await client.updateSettings({ enabled: nextEnabled });
      dispatch({
        type: 'statusUpdated',
        status,
        notice: nextEnabled
          ? 'Google Calendar plugin enabled for the configured local user.'
          : 'Google Calendar plugin disabled. New tool dispatches are blocked.',
      });
    } catch (err: unknown) {
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not update Google Calendar setting.';
      dispatch({ type: 'failed', message });
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async () => {
    if (inflightRef.current || disabled) return;
    setBusy(true);
    dispatch({ type: 'begin', pending: 'oauth-start' });
    try {
      const response = await client.startOAuth();
      const ok = navigateToGoogleOAuth(response.authorizationUrl, navigate);
      if (!ok) {
        dispatch({
          type: 'failed',
          message: 'Refused navigation to an untrusted OAuth authorization URL.',
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not start Google Calendar authorization.';
      dispatch({ type: 'failed', message });
    } finally {
      setBusy(false);
    }
  };

  const confirmDisconnect = async () => {
    const prompt = state.disconnectPrompt;
    if (!prompt || inflightRef.current || disabled) return;
    if (prompt.mode === 'revoke-google-grant' && !prompt.acknowledgedProjectWide) {
      return;
    }
    setBusy(true);
    dispatch({ type: 'begin', pending: 'disconnect' });
    try {
      const result = await client.disconnect(
        prompt.mode === 'local'
          ? { mode: 'local' }
          : { mode: 'revoke-google-grant', acknowledgeProjectWideRevocation: true },
      );
      const latestStatus = await client.getStatus();
      dispatch({
        type: 'disconnected',
        status: latestStatus,
        remoteRevocation: result.remoteRevocation,
      });
    } catch (err: unknown) {
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not complete Google Calendar disconnect.';
      dispatch({ type: 'failed', message });
    } finally {
      setBusy(false);
    }
  };

  const closeDisconnect = () => {
    const mode = state.disconnectPrompt?.mode;
    dispatch({ type: 'closeDisconnect' });
    queueMicrotask(() => {
      if (mode === 'local') localDisconnectBtnRef.current?.focus();
      if (mode === 'revoke-google-grant') revokeDisconnectBtnRef.current?.focus();
    });
  };

  const status = state.status;
  const busy = state.pending !== null || disabled;
  const connectionCopy = status ? describeConnectionState(status.state) : null;
  const canStartOAuth =
    status !== null &&
    status.targetCalendarId !== null &&
    status.processingDisclosure !== null &&
    !busy;
  const hasStoredConnection =
    status !== null &&
    (status.state === 'connected' ||
      status.state === 'reconnect-required' ||
      status.state === 'degraded' ||
      status.accountEmail !== null);

  return (
    <section
      className="aurvin-calendar-panel"
      aria-label="Google Calendar connection and settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state.disconnectPrompt && !state.pending) {
          event.preventDefault();
          closeDisconnect();
        }
      }}
    >
      {oauthOutcome ? (
        <div
          className="aurvin-calendar-oauth-banner"
          role="status"
          aria-live="polite"
          data-oauth-outcome={oauthOutcome}
        >
          <p>{describeOAuthOutcome(oauthOutcome)}</p>
          {onDismissOAuthOutcome ? (
            <button type="button" onClick={onDismissOAuthOutcome}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {state.phase === 'loading' ? (
        <p role="status">Loading Google Calendar status…</p>
      ) : null}

      {state.phase === 'unavailable' ? (
        <div className="aurvin-calendar-alert" role="alert">
          <p>{state.error ?? 'Google Calendar setup status is unavailable.'}</p>
          <button type="button" onClick={() => void reloadStatus()}>
            Retry status check
          </button>
        </div>
      ) : null}

      {status && connectionCopy ? (
        <div className="aurvin-calendar-card">
          <div className="aurvin-calendar-header-row">
            <div>
              <h3 className="aurvin-calendar-heading">Google Calendar (embedded MCP)</h3>
              <p className="aurvin-admin-help">
                Single-user local proof bound to the server-configured Aurvin user. Member accounts and RBAC are not enabled.
              </p>
            </div>
            <span
              className="aurvin-calendar-state-badge"
              data-calendar-connection-state={status.state}
            >
              {connectionCopy.badge}
            </span>
          </div>

          <p className="aurvin-calendar-summary">{connectionCopy.summary}</p>

          <dl className="aurvin-calendar-meta">
            <div>
              <dt>Configured target calendar</dt>
              <dd>{status.targetCalendarId ?? 'Not configured on server'}</dd>
            </div>
            <div>
              <dt>Connected Google account</dt>
              <dd>{status.accountEmail ?? 'Not connected'}</dd>
            </div>
            <div>
              <dt>External processing &amp; privacy</dt>
              <dd>
                {status.processingDisclosure
                  ? `${status.processingDisclosure.processors} · Data collection: ${status.processingDisclosure.dataCollection} (policy ${status.processingDisclosure.policyId})`
                  : 'External processing policy not configured on server'}
              </dd>
            </div>
          </dl>

          {status.targetCalendarId === null || status.processingDisclosure === null ? (
            <p className="aurvin-admin-help" role="note">
              Server OAuth credentials, a disposable owned target calendar ID, and an approved processing policy ID are required before connecting.
            </p>
          ) : null}

          <div className="aurvin-calendar-actions">
            {status.enabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleEnabled(false)}
              >
                {state.pending === 'disable' ? 'Disabling…' : 'Disable Google Calendar'}
              </button>
            ) : (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={busy}
                onClick={() => void toggleEnabled(true)}
              >
                {state.pending === 'enable' ? 'Enabling…' : 'Enable Google Calendar'}
              </button>
            )}

            {status.state === 'reconnect-required' || status.state === 'degraded' ? (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={!canStartOAuth}
                onClick={() => void startConnect()}
              >
                {state.pending === 'oauth-start'
                  ? 'Starting OAuth…'
                  : 'Reconnect Google Calendar'}
              </button>
            ) : status.state !== 'connected' ? (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={!canStartOAuth}
                onClick={() => void startConnect()}
              >
                {state.pending === 'oauth-start'
                  ? 'Starting OAuth…'
                  : 'Connect Google Calendar'}
              </button>
            ) : null}

            {hasStoredConnection ? (
              <>
                <button
                  ref={localDisconnectBtnRef}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    dispatch({ type: 'openDisconnect', mode: 'local' })
                  }
                >
                  Disconnect locally
                </button>
                <button
                  ref={revokeDisconnectBtnRef}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    dispatch({ type: 'openDisconnect', mode: 'revoke-google-grant' })
                  }
                >
                  Disconnect &amp; revoke Google grant
                </button>
              </>
            ) : null}
          </div>

          {state.disconnectPrompt ? (
            <div
              className="aurvin-admin-confirm aurvin-calendar-disconnect-confirm"
              role="group"
              aria-label={
                state.disconnectPrompt.mode === 'local'
                  ? 'Confirm local Google Calendar disconnect'
                  : 'Confirm project-wide Google grant revocation and disconnect'
              }
            >
              {state.disconnectPrompt.mode === 'local' ? (
                <>
                  <p>Disconnect Google Calendar locally?</p>
                  <p>
                    Clears stored Aurvin tokens and disables Calendar dispatch immediately without revoking your wider Google project grant or deleting existing Calendar events.
                  </p>
                </>
              ) : (
                <>
                  <p>Revoke Google grant and disconnect?</p>
                  <p>
                    Project-wide implication: revoking the Google grant at Google&apos;s revocation endpoint can invalidate all tokens issued to this OAuth project for your Google account. Existing Calendar events are not deleted.
                  </p>
                  <label className="aurvin-admin-check" htmlFor={`${ids}-ack-revoke`}>
                    <input
                      id={`${ids}-ack-revoke`}
                      type="checkbox"
                      checked={state.disconnectPrompt.acknowledgedProjectWide}
                      disabled={busy}
                      onChange={(event) =>
                        dispatch({
                          type: 'setRevokeAcknowledged',
                          acknowledged: event.target.checked,
                        })
                      }
                    />
                    <span>
                      I understand this revokes the Google grant across this OAuth project
                    </span>
                  </label>
                </>
              )}
              <div className="aurvin-calendar-confirm-actions">
                <button
                  type="button"
                  disabled={
                    busy ||
                    (state.disconnectPrompt.mode === 'revoke-google-grant' &&
                      !state.disconnectPrompt.acknowledgedProjectWide)
                  }
                  onClick={() => void confirmDisconnect()}
                >
                  {state.pending === 'disconnect'
                    ? 'Disconnecting…'
                    : state.disconnectPrompt.mode === 'local'
                      ? 'Confirm local disconnect'
                      : 'Revoke Google grant and disconnect'}
                </button>
                <button type="button" disabled={busy} onClick={closeDisconnect}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {state.notice ? (
            <p className="aurvin-calendar-notice" role="status" aria-live="polite">
              {state.notice}
            </p>
          ) : null}

          {state.error ? (
            <p className="aurvin-admin-field-error" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

Create `frontend/src/features/plugins/google-calendar/calendar-plugin.css`:

```css
.aurvin-calendar-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.aurvin-calendar-oauth-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--aurvin-border);
  background: rgba(255, 255, 255, 0.04);
}

.aurvin-calendar-oauth-banner p {
  margin: 0;
  font-size: 13px;
}

.aurvin-calendar-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--aurvin-border);
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.aurvin-calendar-header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.aurvin-calendar-heading {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.aurvin-calendar-state-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--aurvin-border);
  background: rgba(255, 255, 255, 0.05);
}

.aurvin-calendar-state-badge[data-calendar-connection-state='connected'] {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.1);
}

.aurvin-calendar-state-badge[data-calendar-connection-state='reconnect-required'] {
  color: var(--aurvin-danger);
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.1);
}

.aurvin-calendar-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.aurvin-calendar-meta {
  margin: 0;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--aurvin-border);
  background: rgba(0, 0, 0, 0.2);
}

.aurvin-calendar-meta dt {
  font-size: 12px;
  font-weight: 600;
  color: var(--aurvin-text-secondary);
}

.aurvin-calendar-meta dd {
  margin: 2px 0 0;
  font-size: 13px;
  font-family: var(--aurvin-mono);
  word-break: break-all;
}

.aurvin-calendar-actions,
.aurvin-calendar-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.aurvin-calendar-primary-btn {
  background: var(--aurvin-primary) !important;
  color: var(--aurvin-on-primary) !important;
  border-color: var(--aurvin-primary) !important;
  font-weight: 600;
}

.aurvin-calendar-turn-region {
  width: 100%;
  max-width: 768px;
  margin: 0 auto 12px;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.aurvin-calendar-progress-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--aurvin-border);
  background: var(--aurvin-surface-elevated);
  font-size: 13px;
  color: var(--aurvin-text-primary);
}

.aurvin-calendar-operation-card {
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid var(--aurvin-border);
  background: var(--aurvin-surface-elevated);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
}

.aurvin-calendar-operation-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aurvin-calendar-receipt-title {
  font-weight: 600;
}

.aurvin-calendar-receipt-id {
  font-family: var(--aurvin-mono);
  font-size: 12px;
  color: var(--aurvin-text-secondary);
}

.aurvin-calendar-receipt-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  font-size: 13px;
  font-weight: 500;
  color: var(--aurvin-text-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.aurvin-calendar-narration-warning {
  margin: 0;
  font-size: 13px;
  color: var(--aurvin-text-secondary);
}

.aurvin-calendar-retry-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}

.aurvin-calendar-retry-explanation {
  margin: 0;
  font-size: 13px;
  color: var(--aurvin-text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .aurvin-calendar-panel *,
  .aurvin-calendar-turn-region * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 4: Run the setup state and panel tests to verify they pass**

Run from `frontend/`:
```powershell
npm test -- src/features/plugins/google-calendar/calendar-setup-state.test.ts src/features/plugins/google-calendar/google-calendar-panel.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/features/plugins/google-calendar/calendar-setup-state.ts" "frontend/src/features/plugins/google-calendar/calendar-setup-state.test.ts" "frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx" "frontend/src/features/plugins/google-calendar/google-calendar-panel.test.ts" "frontend/src/features/plugins/google-calendar/calendar-plugin.css"
git commit -m "feat(frontend): add GoogleCalendarPanel and setup state machine"
```

---

### Task 4: Implement `CalendarTurnRegion` for Chat Progress, Durable Receipts, Narration Failure, and Retry Flows

**Files:**
- Create: `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`
- Create: `frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts`
- Create: `frontend/src/features/plugins/google-calendar/index.ts`

- [ ] **Step 1: Write the failing tests in `frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts`**

Create `frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts`:

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarTurnState } from '../../../api/calendar-protocol.ts';
import {
  CalendarTurnView,
  describeCalendarProgress,
  describeCalendarRetryAction,
  resolveSafeReceiptLink,
} from './CalendarTurnRegion.tsx';

describe('CalendarTurnRegion presentation and SSR', () => {
  it('describes validating, repairing ("Correcting the Calendar request…"), executing, and reconciling without raw schema dumps', () => {
    expect(describeCalendarProgress('validating')).toBe('Validating Calendar request…');
    expect(describeCalendarProgress('repairing')).toBe('Correcting the Calendar request…');
    expect(describeCalendarProgress('executing')).toBe('Running Calendar action…');
    expect(describeCalendarProgress('reconciling')).toBe('Reconciling Calendar outcome…');

    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: 'repairing',
        operations: [],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).toContain('Correcting the Calendar request…');
    expect(html).not.toContain('SCHEMA_VALIDATION_FAILED');
  });

  it('never renders a Created receipt from provisional text when no durable succeeded operation exists', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: 'executing',
        operations: [],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).not.toContain('Calendar event created');
    expect(html).not.toContain('Open in Google Calendar');
  });

  it('renders durable created-event receipt independently of a failed or interrupted final narration', () => {
    const operation: CalendarTurnState = {
      operationId: 'op_created_1',
      state: 'succeeded',
      narration: 'failed',
      retryAction: 'none',
      receipt: {
        durable: true,
        eventId: 'gcal_evt_12345',
        htmlLink: 'https://www.google.com/calendar/event?eid=gcal123',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    };
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [{ turnId: 'turn_1', operation }],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).toContain('Calendar event created');
    expect(html).toContain('gcal_evt_12345');
    expect(html).toContain('href="https://www.google.com/calendar/event?eid=gcal123"');
    expect(html).toContain('Open in Google Calendar');
    expect(html).toContain(
      'The Calendar event was created and saved, but the final assistant response failed.',
    );
    expect(html).toContain('Retry assistant response (reuses saved event)');
  });

  it('withholds expired or unsafe receipt links while keeping the verified event ID', () => {
    expect(
      resolveSafeReceiptLink(
        {
          durable: true,
          eventId: 'evt_12345',
          htmlLink: 'https://www.google.com/calendar/event?eid=1',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        Date.parse('2026-10-21T00:00:00.000Z'),
      ),
    ).toBeNull();

    expect(
      resolveSafeReceiptLink(
        {
          durable: true,
          eventId: 'evt_12345',
          htmlLink: 'javascript:alert(1)',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        Date.parse('2026-10-21T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('explains whether retry resumes reconciliation, requires reconnection, requires clarification, or is blocked by expiry', () => {
    expect(describeCalendarRetryAction('resume-reconciliation').explanation).toContain(
      'same event ID without creating a duplicate event',
    );
    expect(describeCalendarRetryAction('reconnect').explanation).toContain(
      'reconnection is required',
    );
    expect(describeCalendarRetryAction('clarify').explanation).toContain(
      'More details are needed',
    );
    expect(describeCalendarRetryAction('blocked-expired').explanation).toContain(
      'deduplication evidence expired',
    );

    const unknownOp: CalendarTurnState = {
      operationId: 'op_unk',
      state: 'unknown',
      narration: 'failed',
      retryAction: 'resume-reconciliation',
      receipt: null,
    };
    const reconnectOp: CalendarTurnState = {
      operationId: 'op_rec',
      state: 'definitely-failed',
      narration: 'failed',
      retryAction: 'reconnect',
      receipt: null,
    };
    const clarifyOp: CalendarTurnState = {
      operationId: 'op_clar',
      state: 'definitely-failed',
      narration: 'completed',
      retryAction: 'clarify',
      receipt: null,
    };

    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [
          { turnId: 'turn_u', operation: unknownOp },
          { turnId: 'turn_r', operation: reconnectOp },
          { turnId: 'turn_c', operation: clarifyOp },
        ],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );

    expect(html).toContain('Calendar outcome is uncertain and requires reconciliation.');
    expect(html).toContain('Resume &amp; reconcile operation');
    expect(html).toContain('Reconnect Google Calendar');
    expect(html).toContain('Clarify in composer');
  });
});
```

- [ ] **Step 2: Run the `calendar-turn-region` test suite to verify it fails**

Run from `frontend/`:
```powershell
npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts
```
Expected: FAIL because `CalendarTurnRegion.tsx` does not exist yet.

- [ ] **Step 3: Implement `CalendarTurnRegion.tsx` and `index.ts`**

Create `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`:

```tsx
import {
  isSafeCalendarEventLink,
  type CalendarDurableReceipt,
  type CalendarOperationState,
  type CalendarProgressPhase,
  type CalendarRetryAction,
  type CalendarTurnState,
} from '../../../api/calendar-protocol.ts';
import { useChat } from '../../chat/state/chat-context.tsx';
import './calendar-plugin.css';

export function describeCalendarProgress(phase: CalendarProgressPhase): string {
  switch (phase) {
    case 'validating':
      return 'Validating Calendar request…';
    case 'repairing':
      return 'Correcting the Calendar request…';
    case 'executing':
      return 'Running Calendar action…';
    case 'reconciling':
      return 'Reconciling Calendar outcome…';
  }
}

export function describeOperationState(state: CalendarOperationState): string {
  switch (state) {
    case 'succeeded':
      return 'Calendar event created';
    case 'unknown':
      return 'Calendar outcome is uncertain and requires reconciliation.';
    case 'definitely-failed':
      return 'Calendar action was not completed. No Calendar event was created.';
    case 'evidence-expired':
      return 'Calendar deduplication evidence has expired. Automatic replay is blocked.';
    case 'planned':
    case 'dispatching':
      return 'Calendar operation was interrupted before completion could be confirmed.';
  }
}

export function describeCalendarRetryAction(retryAction: CalendarRetryAction): {
  explanation: string;
  buttonLabel: string | null;
} {
  switch (retryAction) {
    case 'resume-reconciliation':
      return {
        explanation:
          'Retry will resume and reconcile the existing Calendar operation using the same event ID without creating a duplicate event.',
        buttonLabel: 'Resume & reconcile operation',
      };
    case 'reconnect':
      return {
        explanation:
          'Google Calendar reconnection is required before this request can continue.',
        buttonLabel: 'Reconnect Google Calendar',
      };
    case 'clarify':
      return {
        explanation:
          'More details are needed (such as an exact date, time, or timezone). Send a clarifying message in the composer below.',
        buttonLabel: 'Clarify in composer',
      };
    case 'blocked-expired':
      return {
        explanation:
          'Replay is blocked because operation deduplication evidence expired. Check your Google Calendar before sending a new request.',
        buttonLabel: null,
      };
    case 'none':
      return {
        explanation: '',
        buttonLabel: null,
      };
  }
}

export function resolveSafeReceiptLink(
  receipt: CalendarDurableReceipt | null,
  nowMs: number = Date.now(),
): string | null {
  if (!receipt || !receipt.durable || receipt.htmlLink === null) {
    return null;
  }
  if (!isSafeCalendarEventLink(receipt.htmlLink)) {
    return null;
  }
  if (receipt.expiresAt === null) {
    return null;
  }
  const expiresAtMs = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return null;
  }
  return receipt.htmlLink;
}

export type CalendarTurnItem = {
  turnId: string;
  operation: CalendarTurnState;
};

export type CalendarTurnViewProps = {
  progress: CalendarProgressPhase | null;
  operations: readonly CalendarTurnItem[];
  disabled: boolean;
  nowMs?: number;
  onRetryTurn: (turnId: string) => void;
  onOpenCalendarSetup?: () => void;
  onFocusComposer?: () => void;
};

export function CalendarTurnView({
  progress,
  operations,
  disabled,
  nowMs = Date.now(),
  onRetryTurn,
  onOpenCalendarSetup,
  onFocusComposer,
}: CalendarTurnViewProps) {
  if (progress === null && operations.length === 0) {
    return null;
  }

  return (
    <section
      className="aurvin-calendar-turn-region"
      aria-label="Google Calendar activity"
      aria-live="polite"
    >
      {progress !== null ? (
        <div
          className="aurvin-calendar-progress-pill"
          role="status"
          data-calendar-progress={progress}
        >
          <span>{describeCalendarProgress(progress)}</span>
        </div>
      ) : null}

      {operations.map(({ turnId, operation }) => {
        const isCreated =
          operation.state === 'succeeded' &&
          operation.receipt !== null &&
          operation.receipt.durable === true;
        const safeLink = isCreated ? resolveSafeReceiptLink(operation.receipt, nowMs) : null;
        const retryMeta = describeCalendarRetryAction(operation.retryAction);
        const showFailedNarrationRetry =
          isCreated &&
          operation.retryAction === 'none' &&
          (operation.narration === 'failed' || operation.narration === 'interrupted');

        return (
          <article
            key={`${turnId}:${operation.operationId}`}
            className="aurvin-calendar-operation-card"
            data-calendar-state={operation.state}
            data-calendar-narration={operation.narration}
            data-receipt-durable={isCreated ? 'true' : 'false'}
          >
            <div className="aurvin-calendar-operation-header">
              <span className="aurvin-calendar-receipt-title">
                {describeOperationState(operation.state)}
              </span>
              {isCreated && operation.receipt ? (
                <span className="aurvin-calendar-receipt-id">
                  Event ID: {operation.receipt.eventId}
                </span>
              ) : null}
            </div>

            {isCreated ? (
              safeLink ? (
                <a
                  href={safeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aurvin-calendar-receipt-link"
                >
                  Open in Google Calendar
                </a>
              ) : (
                <p className="aurvin-calendar-narration-warning">
                  Event link unavailable or expired; verified by durable event ID.
                </p>
              )
            ) : null}

            {isCreated && operation.narration === 'failed' ? (
              <p className="aurvin-calendar-narration-warning" role="status">
                The Calendar event was created and saved, but the final assistant response failed. Retrying will not create a duplicate event.
              </p>
            ) : null}

            {isCreated && operation.narration === 'interrupted' ? (
              <p className="aurvin-calendar-narration-warning" role="status">
                The Calendar event was created and saved, but the final assistant stream was interrupted. Retrying will reuse the saved receipt without creating a duplicate event.
              </p>
            ) : null}

            {retryMeta.explanation ? (
              <div className="aurvin-calendar-retry-box">
                <p className="aurvin-calendar-retry-explanation">{retryMeta.explanation}</p>
                {operation.retryAction === 'resume-reconciliation' ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    disabled={disabled}
                    onClick={() => onRetryTurn(turnId)}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
                {operation.retryAction === 'reconnect' && onOpenCalendarSetup ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    onClick={onOpenCalendarSetup}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
                {operation.retryAction === 'clarify' && onFocusComposer ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    onClick={onFocusComposer}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
              </div>
            ) : null}

            {showFailedNarrationRetry ? (
              <div className="aurvin-calendar-retry-box">
                <p className="aurvin-calendar-retry-explanation">
                  Event creation is already complete. If you retry the turn, Aurvin will reuse the saved event receipt without creating a second event.
                </p>
                <button
                  type="button"
                  className="aurvin-retry-btn"
                  disabled={disabled}
                  onClick={() => onRetryTurn(turnId)}
                >
                  Retry assistant response (reuses saved event)
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

export function CalendarTurnRegion({
  onOpenCalendarSetup,
  onFocusComposer,
}: {
  onOpenCalendarSetup?: () => void;
  onFocusComposer?: () => void;
}) {
  const { state, actions } = useChat();
  const operations: CalendarTurnItem[] = (state.calendarTurnOrder ?? [])
    .map((turnId) => {
      const operation = state.calendarOperationsByTurn?.[turnId];
      return operation ? { turnId, operation } : null;
    })
    .filter((item): item is CalendarTurnItem => item !== null);

  return (
    <CalendarTurnView
      progress={state.calendarProgress ?? null}
      operations={operations}
      disabled={Boolean(state.isStreaming || state.isSubmitting || state.voiceInput)}
      onRetryTurn={(turnId) => void actions.retryTurn(turnId)}
      onOpenCalendarSetup={onOpenCalendarSetup}
      onFocusComposer={onFocusComposer}
    />
  );
}
```

Create `frontend/src/features/plugins/google-calendar/index.ts`:

```typescript
export {
  CalendarTurnRegion,
  CalendarTurnView,
  describeCalendarProgress,
  describeCalendarRetryAction,
  describeOperationState,
  resolveSafeReceiptLink,
  type CalendarTurnItem,
  type CalendarTurnViewProps,
} from './CalendarTurnRegion.tsx';
export {
  GoogleCalendarPanel,
  type GoogleCalendarPanelProps,
} from './GoogleCalendarPanel.tsx';
export {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  describeConnectionState,
  describeOAuthOutcome,
  describeRemoteRevocation,
  navigateToGoogleOAuth,
  type CalendarSetupAction,
  type CalendarSetupState,
  type DisconnectMode,
} from './calendar-setup-state.ts';
```

- [ ] **Step 4: Run the `calendar-turn-region` test suite to verify it passes**

Run from `frontend/`:
```powershell
npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx" "frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts" "frontend/src/features/plugins/google-calendar/index.ts"
git commit -m "feat(frontend): add CalendarTurnRegion for progress, receipts, and retries"
```

---

### Task 5: Integrate Calendar Progress and Durable Operations into Chat State, Orchestration, and `ChatView`

**Files:**
- Modify: `frontend/src/features/chat/state/chat-types.ts`
- Modify: `frontend/src/features/chat/state/chat-reducer.ts`
- Modify: `frontend/src/features/chat/state/chat-reducer.test.ts`
- Modify: `frontend/src/features/chat/state/use-chat.ts`
- Modify: `frontend/src/features/chat/ChatView.tsx`

- [ ] **Step 1: Write the failing reducer tests in `frontend/src/features/chat/state/chat-reducer.test.ts`**

Append to `frontend/src/features/chat/state/chat-reducer.test.ts` inside `describe('chatReducer', ...)`:

```typescript
  it('tracks Calendar progress, preserves durable receipts across failed/interrupted narration, and resets session Calendar state on NEW_CHAT while keeping draftInput', () => {
    let state: ChatState = {
      ...initialChatState,
      activeSessionId: 'sess_cal',
      activeTurnId: 'turn_cal_1',
      isStreaming: true,
      turnStatus: 'generating',
      draftInput: 'Keep this unsent draft',
    };

    state = chatReducer(state, {
      type: 'CALENDAR_PROGRESS',
      payload: { turnId: 'turn_cal_1', phase: 'repairing' },
    });
    expect(state.calendarProgress).toBe('repairing');

    const receiptOp = {
      operationId: 'op_1',
      state: 'succeeded' as const,
      narration: 'pending' as const,
      retryAction: 'none' as const,
      receipt: {
        durable: true as const,
        eventId: 'evt_cal_999',
        htmlLink: 'https://www.google.com/calendar/event?eid=999',
        expiresAt: '2026-10-22T00:00:00.000Z',
      },
    };

    state = chatReducer(state, {
      type: 'CALENDAR_OPERATION',
      payload: { turnId: 'turn_cal_1', operation: receiptOp },
    });
    expect(state.calendarProgress).toBeNull();
    expect(state.calendarOperationsByTurn['turn_cal_1']?.receipt?.eventId).toBe('evt_cal_999');

    // Final narration fails after Calendar write succeeded
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: { code: 'PROVIDER_ERROR', message: 'Narration failed', retryable: true },
    });
    expect(state.turnStatus).toBe('failed');
    expect(state.calendarOperationsByTurn['turn_cal_1']).toEqual({
      ...receiptOp,
      narration: 'failed',
    });

    // NEW_CHAT resets session Calendar state without losing draftInput
    const reset = chatReducer(state, { type: 'NEW_CHAT' });
    expect(reset.activeSessionId).toBeNull();
    expect(reset.calendarProgress).toBeNull();
    expect(reset.calendarOperationsByTurn).toEqual({});
    expect(reset.calendarTurnOrder).toEqual([]);
    expect(reset.draftInput).toBe('Keep this unsent draft');
  });
```

- [ ] **Step 2: Run `chat-reducer.test.ts` to verify it fails**

Run from `frontend/`:
```powershell
npm test -- src/features/chat/state/chat-reducer.test.ts
```
Expected: FAIL because `CALENDAR_PROGRESS` and `CALENDAR_OPERATION` are not yet in `chat-types.ts` or `chat-reducer.ts`.

- [ ] **Step 3: Update `chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`, and `ChatView.tsx`**

In `frontend/src/features/chat/state/chat-types.ts`, import `CalendarProgressPhase` and `CalendarTurnState` from `../../../api/calendar-protocol.ts` and add the state fields and actions:

```typescript
import type {
  CalendarProgressPhase,
  CalendarTurnState,
} from '../../../api/calendar-protocol.ts';
import type {
  AttemptStatus,
  ClientErrorBody,
  SessionSummary,
  VisibleMessage,
} from '../../../api/protocol.ts';
```

Add to `ChatState` in `frontend/src/features/chat/state/chat-types.ts`:

```typescript
  calendarProgress: CalendarProgressPhase | null;
  calendarOperationsByTurn: Record<string, CalendarTurnState>;
  calendarTurnOrder: string[];
```

Add to `ChatAction` in `frontend/src/features/chat/state/chat-types.ts`:

```typescript
  | { type: 'CALENDAR_PROGRESS'; payload: { turnId: string; phase: CalendarProgressPhase } }
  | { type: 'CALENDAR_OPERATION'; payload: { turnId: string; operation: CalendarTurnState } }
```

In `frontend/src/features/chat/state/chat-reducer.ts`:
1. Add to `initialChatState`:
```typescript
  calendarProgress: null,
  calendarOperationsByTurn: {},
  calendarTurnOrder: [],
```
2. Add a helper above `chatReducer` to update pending narration status on the active turn's Calendar operation when a stream terminates:
```typescript
function syncActiveCalendarNarration(
  state: ChatState,
  narration: 'completed' | 'failed' | 'interrupted',
): Record<string, ChatState['calendarOperationsByTurn'][string]> {
  const turnId = state.activeTurnId;
  if (!turnId) return state.calendarOperationsByTurn;
  const existing = state.calendarOperationsByTurn[turnId];
  if (!existing || existing.narration !== 'pending') {
    return state.calendarOperationsByTurn;
  }
  return {
    ...state.calendarOperationsByTurn,
    [turnId]: {
      ...existing,
      narration,
    },
  };
}
```
3. In `NEW_CHAT` and `SELECT_SESSION` cases in `chat-reducer.ts`, reset:
```typescript
        calendarProgress: null,
        calendarOperationsByTurn: {},
        calendarTurnOrder: [],
```
4. In `TURN_SUBMIT_START` and `TURN_SUBMIT_ERROR`, set `calendarProgress: null`.
5. Add cases `CALENDAR_PROGRESS` and `CALENDAR_OPERATION` in `chat-reducer.ts`:
```typescript
    case 'CALENDAR_PROGRESS':
      return {
        ...state,
        calendarProgress: action.payload.phase,
      };

    case 'CALENDAR_OPERATION': {
      const { turnId, operation } = action.payload;
      const isTerminalOp =
        operation.state === 'succeeded' ||
        operation.state === 'definitely-failed' ||
        operation.state === 'unknown' ||
        operation.state === 'evidence-expired';
      const order = state.calendarTurnOrder.includes(turnId)
        ? state.calendarTurnOrder
        : [...state.calendarTurnOrder, turnId];
      return {
        ...state,
        calendarProgress: isTerminalOp ? null : state.calendarProgress,
        calendarOperationsByTurn: {
          ...state.calendarOperationsByTurn,
          [turnId]: operation,
        },
        calendarTurnOrder: order,
      };
    }
```
6. In `STREAM_COMPLETED`, `STREAM_ERROR`, `STREAM_CANCELLED`, and `STREAM_INTERRUPTED` in `chat-reducer.ts`, clear `calendarProgress: null` and sync pending narration:
- In `STREAM_COMPLETED`:
  ```typescript
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'completed'),
  ```
- In `STREAM_ERROR`:
  ```typescript
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'failed'),
  ```
- In `STREAM_CANCELLED`:
  ```typescript
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'interrupted'),
  ```
- In `STREAM_INTERRUPTED`:
  ```typescript
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'interrupted'),
  ```

In `frontend/src/features/chat/state/use-chat.ts`:
1. Update the import from `../../../api/protocol.ts` to also import `CalendarCompatibleEnvelope` and `CalendarStreamEvent` from `../../../api/calendar-protocol.ts`:
```typescript
import type {
  CalendarCompatibleEnvelope,
  CalendarStreamEvent,
} from '../../../api/calendar-protocol.ts';
```
2. Update `dispatchStreamEvent` in `use-chat.ts` to handle `calendar-progress` and `calendar-operation`:
```typescript
  const dispatchStreamEvent = useCallback(
    (
      event: CalendarStreamEvent,
      envelope: CalendarCompatibleEnvelope,
      reloadSessions: () => void,
    ) => {
      if (event.type === 'delta') {
        dispatch({ type: 'STREAM_DELTA', payload: { text: event.text } });
      } else if (event.type === 'status') {
        dispatch({ type: 'STREAM_STATUS', payload: { status: event.status, truncated: event.truncated } });
      } else if (event.type === 'calendar-progress') {
        dispatch({
          type: 'CALENDAR_PROGRESS',
          payload: { turnId: envelope.turnId, phase: event.phase },
        });
      } else if (event.type === 'calendar-operation') {
        dispatch({
          type: 'CALENDAR_OPERATION',
          payload: { turnId: envelope.turnId, operation: event.operation },
        });
      } else if (event.type === 'completed') {
        dispatch({
          type: 'STREAM_COMPLETED',
          payload: {
            assistantMessageId: event.assistantMessageId,
            outcome: event.outcome,
          },
        });
        reloadSessions();
      } else if (event.type === 'error') {
        dispatch({
          type: 'STREAM_ERROR',
          payload: { code: event.code, message: event.message, retryable: event.retryable },
        });
      }
    },
    [dispatch],
  );
```
3. In `submitMessage` (`use-chat.ts`), pass `calendarProtocol: 2` on `client.submitTurn` and forward `(event, envelope)` to `dispatchStreamEvent`:
```typescript
        const response = await client.submitTurn(
          {
            sessionId: state.activeSessionId,
            content: text,
            idempotencyKey,
            calendarProtocol: 2,
          },
          { signal: abortController.signal },
        );
```
and in `connectTurnStream` inside both `submitMessage` and `retryTurn`:
```typescript
            onEvent: (event, envelope) => {
              dispatchStreamEvent(event, envelope, () => {
                void loadSessions();
              });
            },
```
4. In `retryTurn` (`use-chat.ts`), pass `calendarProtocol: 2`:
```typescript
        const response = await client.retryTurn(
          state.activeSessionId,
          turnId,
          { idempotencyKey, calendarProtocol: 2 },
          { signal: abortController.signal },
        );
```

In `frontend/src/features/chat/ChatView.tsx`:
1. Import `CalendarTurnRegion` from `../plugins/google-calendar/index.ts`:
```typescript
import { CalendarTurnRegion } from '../plugins/google-calendar/index.ts';
```
2. Add optional `onOpenCalendarSetup?: () => void;` to `ChatView` props:
```typescript
export function ChatView(props: {
  liveVoice?: LiveVoiceSurface;
  visible?: boolean;
  onManageAurvin?: () => void;
  onOpenCalendarSetup?: () => void;
}) {
```
3. Add a `focusComposer` helper in `ChatView` and render `<CalendarTurnRegion />` right after `<Transcript />` (when `!isEmpty` and `!liveActive`):
```tsx
            {isEmpty ? (
              <div className="aurvin-empty">
                <EmptyState key={greetingKey} />
                <Composer variant="centered" />
              </div>
            ) : (
              <>
                <Transcript />
                <CalendarTurnRegion
                  onOpenCalendarSetup={props.onOpenCalendarSetup ?? props.onManageAurvin}
                  onFocusComposer={() => {
                    mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea')?.focus();
                  }}
                />
              </>
            )}
```

- [ ] **Step 4: Run chat reducer, acceptance, orchestration, and view tests**

Run from `frontend/`:
```powershell
npm test -- src/features/chat/state/chat-reducer.test.ts src/features/chat/chat-acceptance.test.ts src/features/chat/state/chat-orchestration.test.ts src/features/chat/ChatView.test.ts src/features/chat/ChatView.voice.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/features/chat/state/chat-types.ts" "frontend/src/features/chat/state/chat-reducer.ts" "frontend/src/features/chat/state/chat-reducer.test.ts" "frontend/src/features/chat/state/use-chat.ts" "frontend/src/features/chat/ChatView.tsx"
git commit -m "feat(frontend): wire Calendar progress, durable receipts, and protocol v2 in chat"
```

---

### Task 6: Wire `GoogleCalendarPanel` in `AdminDashboard` and OAuth Callback Scrubbing in `App.tsx`

**Files:**
- Modify: `frontend/src/features/admin-config/AdminDashboard.tsx`
- Modify: `frontend/src/features/admin-config/admin-dashboard.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.assembly.test.ts`

- [ ] **Step 1: Write the failing tests in `frontend/src/features/admin-config/admin-dashboard.test.ts` and `frontend/src/App.assembly.test.ts`**

Append to `frontend/src/features/admin-config/admin-dashboard.test.ts`:

```typescript
it('includes Google Calendar in the settings section rail and renders GoogleCalendarPanel when selected', () => {
  const html = renderToStaticMarkup(
    createElement(AdminDashboard, {
      client,
      onBackToChat: () => undefined,
      refreshCapabilities: async () => true,
      initialSection: 'calendar',
      initialCalendarStatus: {
        protocolVersion: 1,
        state: 'connected',
        enabled: true,
        accountEmail: 'operator@example.com',
        targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
        processingDisclosure: {
          policyId: 'policy-1',
          processors: 'Google, OpenRouter and the configured model provider',
          dataCollection: 'deny',
        },
      },
    }),
  );
  expect(html).toContain('Google Calendar');
  expect(html).toContain('Loading configuration');
});
```

Append to `frontend/src/App.assembly.test.ts`:

```typescript
it('accepts an injected calendarClient and scrubs OAuth callback URL parameters without storage writes', async () => {
  const { extractAndScrubCalendarOAuthCallback } = await import('./api/calendar-protocol.ts')
  const scrubbed = extractAndScrubCalendarOAuthCallback(
    'http://127.0.0.1:5173/?plugin=google-calendar&oauth=connected&code=secret&state=nonce',
  )
  expect(scrubbed).toEqual({
    outcome: 'connected',
    scrubbedPathAndSearch: '/',
    hadSensitiveParams: true,
  })
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('calendarClient?: CalendarClient')
  expect(app).not.toMatch(/localStorage|sessionStorage/)
})
```

- [ ] **Step 2: Run the admin dashboard and assembly tests to verify they fail**

Run from `frontend/`:
```powershell
npm test -- src/features/admin-config/admin-dashboard.test.ts src/App.assembly.test.ts
```
Expected: FAIL because `AdminDashboard` and `App.tsx` do not yet accept `initialSection` / `calendarClient`.

- [ ] **Step 3: Update `AdminDashboard.tsx` and `App.tsx`**

In `frontend/src/features/admin-config/AdminDashboard.tsx`:
1. Import `createCalendarClient`, `type CalendarClient` from `../../api/calendar-client.ts`, `type CalendarOAuthCallbackOutcome`, `type CalendarPublicStatus` from `../../api/calendar-protocol.ts`, and `GoogleCalendarPanel` from `../plugins/google-calendar/index.ts`.
2. Define `export type DashboardSection = AdminSection | 'calendar';` and add `{ id: 'calendar', label: 'Google Calendar' }` to `SECTIONS`:
```typescript
export type DashboardSection = AdminSection | 'calendar';

export type AdminDashboardProps = {
  client: AdminConfigClient;
  calendarClient?: CalendarClient;
  onBackToChat: () => void;
  refreshCapabilities: () => Promise<boolean>;
  chatActive?: boolean;
  initialSection?: DashboardSection;
  initialCalendarStatus?: CalendarPublicStatus | null;
  oauthOutcome?: CalendarOAuthCallbackOutcome | null;
  onDismissOAuthOutcome?: () => void;
};

const SECTIONS: { id: DashboardSection; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'chat', label: 'Chat limits' },
  { id: 'voice', label: 'Voice' },
  { id: 'deepgram', label: 'Deepgram' },
  { id: 'calendar', label: 'Google Calendar' },
];
```
3. In `AdminDashboard`:
   - Initialize `const [defaultCalendarClient] = useState(() => createCalendarClient());`
   - Initialize `const [section, setSection] = useState<DashboardSection>(initialSection ?? 'openrouter');`
   - Sync `useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);`
   - Add `const [calendarBusy, setCalendarBusy] = useState(false);` and include it in `const mutationBusy = pending || credentialBusy || calendarBusy;`.
   - In `sectionDirty`, return `false` when `id === 'calendar'` (`if (id === 'calendar') return false;`).
   - In `<div className="aurvin-admin-main">`, when `section === 'calendar'`, render `<GoogleCalendarPanel />`; otherwise render `CredentialRow`, `ConfigFields`, and `.aurvin-admin-save-row` as before:
```tsx
                <div className="aurvin-admin-main">
                  <h2 className="aurvin-admin-section-title">{SECTIONS.find((item) => item.id === section)?.label}</h2>
                  {section === 'calendar' ? (
                    <GoogleCalendarPanel
                      client={calendarClient ?? defaultCalendarClient}
                      initialStatus={initialCalendarStatus}
                      oauthOutcome={oauthOutcome}
                      onDismissOAuthOutcome={onDismissOAuthOutcome}
                      disabled={editingLocked}
                      onBusy={setCalendarBusy}
                    />
                  ) : (
                    <>
                      {section === 'openrouter' || section === 'deepgram' ? (
                        <CredentialRow
                          provider={section}
                          credential={edit.baseline.credentials[section]}
                          expectedRevision={edit.baseline.revision}
                          disabled={Boolean(edit.pending || edit.stale || edit.uncertain)}
                          client={client}
                          onBusy={setCredentialBusy}
                          onSaved={(config) => {
                            dispatch({ type: 'credentialSaved', config });
                            const epoch = ++refreshEpoch.current;
                            void refreshCapabilities().then((ok) => {
                              if (epoch === refreshEpoch.current) dispatch({ type: 'capabilities', ok });
                            });
                          }}
                          onFailure={(error) => dispatch({
                            type: 'failed',
                            error: {
                              code: error.code,
                              currentRevision: error.currentRevision,
                              fieldErrors: error.fieldErrors,
                              uncertain: error.uncertain,
                            },
                          })}
                        />
                      ) : null}
                      {errors.length > 0 ? (
                        <div ref={summaryRef} className="aurvin-admin-summary" role="alert" tabIndex={-1}>
                          <p>{edit.error ? errorCopy(edit.error.code) : 'Review the highlighted fields before saving.'}</p>
                          {hiddenErrors.map((error) => {
                            const target = fieldSection(error.path);
                            const label = SECTIONS.find((item) => item.id === target)?.label ?? error.path;
                            return (
                              <button key={`${error.path}-${error.code}`} type="button" onClick={() => {
                                if (target) setSection(target);
                              }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <ConfigFields
                        section={section}
                        fields={edit.fields}
                        errors={errors}
                        disabled={editingLocked}
                        onChange={(path, value) => dispatch({ type: 'edit', path, value })}
                      />
                      <div className="aurvin-admin-save-row">
                        <p role="status" aria-live="polite">
                          {edit.pending ? 'Saving' : dirty ? 'Unsaved changes' : activationCopy(edit.baseline)}
                        </p>
                        <p className="aurvin-admin-help">
                          Save changes writes nonsecret edits across sections. It does not save provider keys.
                        </p>
                        {mutationBusy ? <p>Wait for the save to finish</p> : null}
                        <button
                          type="button"
                          className="aurvin-admin-save"
                          disabled={saveLocked(edit)}
                          onClick={save}
                        >
                          Save changes
                        </button>
                        {edit.stale || edit.uncertain ? (
                          <button type="button" onClick={() => reload(true)}>Reload saved settings</button>
                        ) : null}
                        {edit.capabilityWarning ? (
                          <>
                            <p role="status">Saved. Voice availability could not be refreshed. Retry voice refresh before starting a new session.</p>
                            <button type="button" onClick={() => {
                              const epoch = ++refreshEpoch.current;
                              void refreshCapabilities().then((ok) => {
                                if (epoch === refreshEpoch.current) dispatch({ type: 'capabilities', ok });
                              });
                            }}>Retry voice refresh</button>
                          </>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
```

In `frontend/src/App.tsx`:
Update `VoiceChatShell` and `App` to wire `calendarClient`, scrub OAuth callback URL parameters on mount via `window.history.replaceState`, and open the `calendar` section when returning from OAuth or clicking `Reconnect Google Calendar`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { createAdminConfigClient, type AdminConfigClient } from './api/admin-config-client.ts'
import { createCalendarClient, type CalendarClient } from './api/calendar-client.ts'
import {
  extractAndScrubCalendarOAuthCallback,
  type CalendarOAuthCallbackOutcome,
} from './api/calendar-protocol.ts'
import { ChatProvider, ChatView, type ApiClient } from './features/chat/index.ts'
import { useChat } from './features/chat/state/chat-context.tsx'
import { AdminDashboard, type DashboardSection } from './features/admin-config/AdminDashboard.tsx'
import { refreshVoiceCapabilities } from './features/voice/index.ts'
import { useLiveVoice } from './features/voice/state/useLiveVoice.ts'
import './App.css'

export function bindLiveConversation(actions: {
  bindVoiceConversation?: (token: string, conversationId: string) => boolean
} | Record<string, unknown>, token: string, conversationId: string) {
  return (actions as { bindVoiceConversation?: (token: string, conversationId: string) => boolean }).bindVoiceConversation?.(token, conversationId) ?? false
}

export function registerVoiceStart(ref: { current: (() => void) | null }, start: () => void) {
  ref.current = start
  return () => { if (ref.current === start) ref.current = null }
}

function readInitialOAuthCallback(): CalendarOAuthCallbackOutcome | null {
  if (typeof window === 'undefined') return null
  const result = extractAndScrubCalendarOAuthCallback(window.location.href)
  if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', result.scrubbedPathAndSearch)
  }
  return result.outcome
}

function VoiceChatShell({
  startRef,
  adminClient,
  calendarClient,
  refreshCapabilities,
}: {
  startRef: MutableRefObject<(() => void) | null>
  adminClient: AdminConfigClient
  calendarClient: CalendarClient
  refreshCapabilities: () => Promise<boolean>
}) {
  const { state, actions, dispatch } = useChat()
  const [oauthOutcome, setOauthOutcome] = useState<CalendarOAuthCallbackOutcome | null>(() =>
    readInitialOAuthCallback(),
  )
  const [page, setPage] = useState<'chat' | 'admin'>(() =>
    oauthOutcome !== null ? 'admin' : 'chat',
  )
  const [adminSection, setAdminSection] = useState<DashboardSection>(() =>
    oauthOutcome !== null ? 'calendar' : 'openrouter',
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const result = extractAndScrubCalendarOAuthCallback(window.location.href)
    if (result.hadSensitiveParams && typeof window.history?.replaceState === 'function') {
      window.history.replaceState(null, '', result.scrubbedPathAndSearch)
    }
    if (result.outcome !== null) {
      setOauthOutcome(result.outcome)
      setAdminSection('calendar')
      setPage('admin')
    }
  }, [])

  const voice = useLiveVoice({
    conversationId: state.activeSessionId,
    draft: state.draftInput,
    bindings: {
      claimVoiceInput: (mode, onClose) => actions.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => actions.writeVoiceDraft(token, text),
      releaseVoiceInput: (token) => actions.releaseVoiceInput(token),
      bindVoiceConversation: (token, id) => bindLiveConversation(actions, token, id),
      refreshSessions: (
        conversationId?: string,
        voiceSession?: { voiceSessionId: string; durationSeconds: number; startedAt: string },
      ) => {
        void actions.loadSessions()
        const target = conversationId || state.activeSessionId
        if (target && voiceSession) {
          actions.commitVoiceSession({
            sessionId: target,
            voiceSessionId: voiceSession.voiceSessionId,
            durationSeconds: voiceSession.durationSeconds,
            createdAt: voiceSession.startedAt,
          })
        }
        if (target) {
          void actions.reloadMessages(target)
        }
      },
    },
  })
  useLayoutEffect(() => registerVoiceStart(startRef, voice.start), [startRef, voice.start])
  const chatActive = state.isStreaming || state.isSubmitting || state.voiceInput !== null
  return (
    <>
      <div className="aurvin-chat-surface" hidden={page !== 'chat'} inert={page !== 'chat'}>
        <ChatView
          liveVoice={voice}
          visible={page === 'chat'}
          onManageAurvin={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection('openrouter')
            setPage('admin')
          }}
          onOpenCalendarSetup={() => {
            dispatch({ type: 'CLOSE_SIDEBAR' })
            setAdminSection('calendar')
            setPage('admin')
          }}
        />
      </div>
      {page === 'admin' ? (
        <AdminDashboard
          client={adminClient}
          calendarClient={calendarClient}
          initialSection={adminSection}
          oauthOutcome={oauthOutcome}
          onDismissOAuthOutcome={() => setOauthOutcome(null)}
          refreshCapabilities={refreshCapabilities}
          chatActive={chatActive}
          onBackToChat={() => setPage('chat')}
        />
      ) : null}
    </>
  )
}

function App({
  client,
  adminClient,
  calendarClient,
  refreshCapabilities,
}: {
  client?: ApiClient
  adminClient?: AdminConfigClient
  calendarClient?: CalendarClient
  refreshCapabilities?: () => Promise<boolean>
} = {}) {
  const startRef = useRef<(() => void) | null>(null)
  const startVoiceConversation = useCallback(() => { startRef.current?.() }, [])
  const [defaultAdminClient] = useState(() => createAdminConfigClient())
  const [defaultCalendarClient] = useState(() => createCalendarClient())
  return (
    <ChatProvider client={client} startVoiceConversation={startVoiceConversation}>
      <VoiceChatShell
        startRef={startRef}
        adminClient={adminClient ?? defaultAdminClient}
        calendarClient={calendarClient ?? defaultCalendarClient}
        refreshCapabilities={refreshCapabilities ?? refreshVoiceCapabilities}
      />
    </ChatProvider>
  )
}

export default App
```

- [ ] **Step 4: Run the admin dashboard, navigation, and assembly tests**

Run from `frontend/`:
```powershell
npm test -- src/features/admin-config/admin-dashboard.test.ts src/features/admin-config/navigation.test.ts src/App.assembly.test.ts src/features/chat/integration-tests/welcome-and-safe-render.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- "frontend/src/features/admin-config/AdminDashboard.tsx" "frontend/src/features/admin-config/admin-dashboard.test.ts" "frontend/src/App.tsx" "frontend/src/App.assembly.test.ts"
git commit -m "feat(frontend): wire GoogleCalendarPanel in AdminDashboard and OAuth URL scrubbing in App"
```

---

### Task 7: Add Closed Browser Fixture for Calendar Setup, Progress, Durable Receipts, and Draft Preservation

**Files:**
- Create: `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html`
- Create: `frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx`

- [ ] **Step 1: Create the development-only closed browser fixture files**

Create `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aurvin Google Calendar Browser Fixture</title>
  </head>
  <body>
    <p id="fixture-status" role="status">Running checks</p>
    <ul id="fixture-checks"></ul>
    <div id="root"></div>
    <script type="module" src="./calendar-browser.tsx"></script>
  </body>
</html>
```

Create `frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx`:

```tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CALENDAR_CSRF_HEADER, type CalendarPublicStatus } from '../../../../api/calendar-protocol.ts';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO } from '../../../../api/voice-protocol.ts';
import { check, press, typeInput } from '../../../admin-config/testing/browser-checks.ts';
import { publicConfig } from '../../../admin-config/testing/fixtures.ts';
import '../../../../index.css';

if (!import.meta.env.DEV) {
  throw new Error('The Google Calendar browser fixture refuses non-development execution.');
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const voiceConfig = {
  protocolVersion: 1 as const,
  enabledModes: { dictation: false, live: false },
  supportedLocales: ['en-US'] as ['en-US'],
  limits: { ...DEFAULT_VOICE_LIMITS },
  inputAudio: { ...INPUT_AUDIO },
  outputAudio: { ...OUTPUT_AUDIO },
};

let calendarStatus: CalendarPublicStatus = {
  protocolVersion: 1,
  state: 'setup-required',
  enabled: true,
  accountEmail: null,
  targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
  processingDisclosure: {
    policyId: 'policy-local-1',
    processors: 'Google, OpenRouter and the configured model provider',
    dataCollection: 'deny',
  },
};

const calendarMutations: Array<{ method: string; path: string; csrf: string | null; body: unknown }> = [];
let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function pathname(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

function pushV2Sse(event: object, sequence: number) {
  const frame = {
    protocolVersion: 2,
    sessionId: 'sess-cal-1',
    turnId: 'turn-cal-1',
    attemptId: 'att-cal-1',
    sequence,
    event,
  };
  streamController?.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
}

window.history.replaceState(
  null,
  '',
  '/?plugin=google-calendar&oauth=fixture&code=secret-code-123&state=secret-state-456',
);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = pathname(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const csrf = headers.get(CALENDAR_CSRF_HEADER);
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (path === '/api/sessions' && method === 'GET') {
    return json({ items: [], nextCursor: null });
  }
  if (path === '/api/sessions' && method === 'POST') {
    return json({
      sessionId: 'sess-cal-1',
      turnId: 'turn-cal-1',
      attemptId: 'att-cal-1',
      userMessageId: 'msg-user-cal-1',
      streamPath: '/sessions/sess-cal-1/turns/turn-cal-1/stream',
    });
  }
  if (path === '/api/sessions/sess-cal-1/turns/turn-cal-1/stream' && method === 'GET') {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (path === '/api/voice/config' && method === 'GET') return json(voiceConfig);
  if (path === '/api/admin/config' && method === 'GET') return json(publicConfig());
  if (path === '/api/plugins/google-calendar/status' && method === 'GET') {
    return json(calendarStatus);
  }
  if (path === '/api/plugins/google-calendar/settings' && method === 'PATCH') {
    calendarMutations.push({ method, path, csrf, body });
    const enabled = Boolean((body as { enabled?: boolean })?.enabled);
    calendarStatus = {
      ...calendarStatus,
      enabled,
      state: enabled ? 'connected' : 'disabled',
      accountEmail: 'operator@example.com',
    };
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

  const { default: App } = await import('../../../../App.tsx');
  const { createApiClient } = await import('../../../../api/client.ts');
  const { createAdminConfigClient } = await import('../../../../api/admin-config-client.ts');
  const { createCalendarClient } = await import('../../../../api/calendar-client.ts');

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

  await step('OAuth callback query is scrubbed and opens Google Calendar panel with fixture notice', async () => {
    check(!window.location.search.includes('code='), 'OAuth code remained in location.search');
    check(!window.location.search.includes('state='), 'OAuth state remained in location.search');
    check(
      mount.textContent?.includes('local fixture mode (not a live Google grant)'),
      'Fixture OAuth notice missing',
    );
    check(
      mount.textContent?.includes('disposable-cal-1@group.calendar.google.com'),
      'Configured target calendar ID missing',
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
    await flush();

    await act(() => {
      pushV2Sse({ type: 'turn-accepted', userMessageId: 'msg-user-cal-1' }, 0);
      pushV2Sse({ type: 'calendar-progress', phase: 'repairing' }, 1);
    });
    await flush();
    check(
      mount.textContent?.includes('Correcting the Calendar request…'),
      'Repairing progress copy missing',
    );

    await act(() => {
      pushV2Sse(
        {
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
        2,
      );
      pushV2Sse(
        {
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: 'Final narration failed after write.',
          retryable: true,
        },
        3,
      );
      streamController?.close();
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
```

- [ ] **Step 2: Run the full frontend verification suite (`test`, `lint`, `build`)**

Run from `frontend/`:
```powershell
npm test
npm run lint
npm run build
```
Expected:
- `npm test`: All Node Vitest test files pass, including `calendar-protocol.test.ts`, `calendar-client.test.ts`, `calendar-setup-state.test.ts`, `google-calendar-panel.test.ts`, `calendar-turn-region.test.ts`, and all existing text/voice/canvas/admin-config suites.
- `npm run lint`: `oxlint` exits 0 with zero errors.
- `npm run build`: `tsc -b && vite build` exits 0 cleanly.

- [ ] **Step 3: Commit**

```powershell
git add -- "frontend/src/features/plugins/google-calendar/testing/calendar-browser.html" "frontend/src/features/plugins/google-calendar/testing/calendar-browser.tsx"
git commit -m "test(frontend): add closed browser fixture for Google Calendar plugin flows"
```

---

## Exit Gate and Handoff Summary for P8 and P9

- **P8 (Assembly, transport, operations, and instructions) handoff:**
  - Frontend calls `GET /api/plugins/google-calendar/status`, `PATCH /api/plugins/google-calendar/settings`, `POST /api/plugins/google-calendar/oauth/start`, and `POST /api/plugins/google-calendar/disconnect` with `X-Aurvin-Calendar-CSRF: 1` and `Content-Type: application/json` on mutations.
  - On browser OAuth callback redirect `${frontendOrigin}/?plugin=google-calendar&oauth=connected|fixture|cancelled|failed`, `App.tsx` reads the outcome, scrubs the query/hash via `window.history.replaceState`, and opens `Manage Aurvin` -> `Google Calendar`.
  - Text-chat `submitMessage` and `retryTurn` advertise `calendarProtocol: 2` and consume `protocolVersion: 2` SSE frames (`calendar-progress` and `calendar-operation`) as well as legacy `protocolVersion: 1` frames.
- **P9 (Integrated verification and live gate) handoff:**
  - P9 owns `frontend/src/features/plugins/integration-tests/**` and can import `createCalendarClient`, `GoogleCalendarPanel`, `CalendarTurnView`, `CalendarTurnRegion`, and the closed browser fixture at `frontend/src/features/plugins/google-calendar/testing/calendar-browser.html`.
  - Node Vitest and local fixture browser checks remain strictly distinct from live Google OAuth / Calendar API certification.
