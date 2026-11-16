import { z } from 'zod';
import type { CalendarConnectionBinding, CalendarConnectionGate, CalendarCredentialPort }
  from '../../../src/contracts/calendar-connections.js';
import type { CalendarExecutionBinding, CalendarOperation, CalendarRequestKind }
  from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_LIMITS, type CalendarLimits } from '../../../src/contracts/calendar-policy.js';
import { sourcePermissionSchema } from '../../../src/contracts/calendar-sources.js';
import type { CalendarCall } from '../../../src/contracts/calendar-tools.js';
import { CalendarApi } from '../../../src/plugins/google-calendar/calendar-api.js';
import { CalendarApiTools } from '../../../src/plugins/google-calendar/tools.js';
import { calendarActionHash, calendarEventId } from '../../../src/plugins/google-calendar/tools-validation.js';
import { multiToolsFixture, multiTarget } from './tools-multi-fixtures.js';

export type FakeStep = {
  method: string;
  path: string;
  response: () => Response | Promise<Response>;
};

export type FakeFetch = { fetcher: typeof fetch; requests: Request[] };

const GOOGLE_ORIGIN = 'https://www.googleapis.com';

/**
 * The default policy deadline sits a few hours ahead of the wall clock so a
 * retained-source fixture stays live on any date. A pinned instant would make
 * the fixture pass or fail depending on the day it runs.
 */
export const POLICY_DEADLINE_AHEAD_MS = 3 * 60 * 60 * 1000;

/**
 * A deterministic scripted Google transport. It fails loudly on an unexpected
 * origin, method or path so a drifting request never passes unnoticed, and it
 * keeps the observed requests in test memory only.
 */
export function fakeFetch(steps: FakeStep[]): FakeFetch {
  const requests: Request[] = [];
  let index = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.origin !== GOOGLE_ORIGIN) throw new Error(`unexpected origin ${url.origin}`);
    const step = steps[index];
    index += 1;
    if (!step) throw new Error('scripted Google responses exhausted');
    if (request.method !== step.method) throw new Error(`expected ${step.method}, received ${request.method}`);
    if (url.pathname !== step.path) throw new Error(`expected path ${step.path}, received ${url.pathname}`);
    requests.push(request);
    return step.response();
  }) as typeof fetch;
  return { fetcher, requests };
}

export function googleJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export const OWNED_CALENDAR = 'owned';

export const FIXTURE_BINDING: CalendarConnectionBinding = {
  userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
  calendarId: OWNED_CALENDAR, targetRevision: 1,
};

export function googleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abcde01234', summary: 'Visit', status: 'confirmed',
    start: { dateTime: '2026-10-21T10:00:00Z', timeZone: 'Etc/UTC' },
    end: { dateTime: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' },
    htmlLink: 'https://calendar.google.com/calendar/event?eid=abcde01234',
    attendees: [{ email: 'fixture-private-attendee' }],
    ...overrides,
  };
}

export function readBinding(overrides: Partial<CalendarExecutionBinding> = {}): CalendarExecutionBinding {
  return {
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', toolCallId: 'tc',
    connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
    calendarId: OWNED_CALENDAR, targetRevision: 1,
    schemaRevision: 'google-calendar.v1', operation: null,
    trustedNow: '2026-10-21T09:00:00.000Z', trustedTimeZone: 'Etc/UTC',
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    ...overrides,
  };
}

export type FixtureReadContext = {
  binding: CalendarExecutionBinding;
  accessToken: string;
  signal: AbortSignal;
  deadlineAt: string;
  consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
};

export function readContext(overrides: Partial<FixtureReadContext> = {}): FixtureReadContext {
  return {
    binding: readBinding(),
    accessToken: 'fixture-access-token',
    signal: new AbortController().signal,
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
    consumeRequest: async () => { /* fixture accounting is a no-op by default */ },
    ...overrides,
  };
}

export const CREATE_ACTION = { summary: 'Visit', start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' };

export type SourcePermission = z.infer<typeof sourcePermissionSchema>;

export type ApiToolsFixture = ReturnType<typeof multiToolsFixture>;
export function apiToolsFixture(options: Omit<NonNullable<Parameters<typeof multiToolsFixture>[0]>, 'target'> = {}): ApiToolsFixture {
  return multiToolsFixture({ ...options, target: multiTarget('owner', OWNED_CALENDAR) });
}

export function savedOperation(overrides: Partial<CalendarOperation> = {}): CalendarOperation {
  const hash = calendarActionHash({ ...CREATE_ACTION });
  return {
    schemaVersion: 1, kind: 'calendar-operation',
    userId: 'u', sessionId: 's', turnId: 't', operationId: 'op_1',
    originatingAttemptId: 'a_1', revision: 1, sequence: 1,
    connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
    calendarId: OWNED_CALENDAR, targetRevision: 1,
    requestHash: hash, googleEventId: calendarEventId('op_1'),
    schemaRevision: 'google-calendar.v1', action: { ...CREATE_ACTION },
    actionSources: [],
    authorization: { acceptedUserMessageId: 'm_1', canonicalActionHash: hash,
      approvedAt: '2026-10-21T08:00:00.000Z', basis: 'explicit-request' },
    deliveryRetries: 0, createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z', auditExpiresAt: '2026-10-28T08:00:00.000Z',
    state: 'dispatching', receipt: null, failure: null,
    ...overrides,
  } as CalendarOperation;
}
