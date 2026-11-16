import { describe, expect, it } from 'vitest';
import { agenda, notice, outcome, proposal } from '../features/canvas/testing/calendar-view-fixtures.ts';
import {
  CALENDAR_API_ROUTES,
  CALENDAR_CSRF_HEADER,
  CALENDAR_CSRF_VALUE,
  CALENDAR_PROTOCOL_VERSION,
  CALENDAR_STATUS_PROTOCOL_V2,
  CALENDAR_STREAM_PROTOCOL_VERSION,
  CALENDAR_STREAM_PROTOCOL_V2,
  extractAndScrubCalendarOAuthCallback,
  isCalendarPresentationEvent,
  isCalendarView,
  isCalendarDisconnectRequest,
  isCalendarDisconnectResponse,
  isCalendarOAuthStartRequest,
  isCalendarOAuthStartResponse,
  isCalendarPublicStatus,
  isCalendarSettingsRequest,
  isCalendarRefreshRequest,
  isCalendarCalendarsResponse,
  isCalendarTurnState,
  isSafeCalendarEventLink,
  isSafeGoogleOAuthUrl,
  parseCalendarCompatibleFrame,
} from './calendar-protocol.ts';
import {
  calendarEntry,
  calendarPage,
  multiStatus,
  clarification,
  createdOperation,
} from '../features/plugins/google-calendar/testing/multi-calendar-fixtures.ts';

describe('calendar-protocol wire guards', () => {
  it('exposes frozen routes, protocol versions, and CSRF header constants', () => {
    expect(CALENDAR_PROTOCOL_VERSION).toBe(1);
    expect(CALENDAR_STATUS_PROTOCOL_V2).toBe(2);
    expect(CALENDAR_STREAM_PROTOCOL_VERSION).toBe(2);
    expect(CALENDAR_STREAM_PROTOCOL_V2).toBe(3);
    expect(CALENDAR_CSRF_HEADER).toBe('X-Aurvin-Calendar-CSRF');
    expect(CALENDAR_CSRF_VALUE).toBe('1');
    expect(CALENDAR_API_ROUTES).toEqual({
      status: '/plugins/google-calendar/status',
      settings: '/plugins/google-calendar/settings',
      oauthStart: '/plugins/google-calendar/oauth/start',
      oauthCallback: '/plugins/google-calendar/oauth/callback',
      disconnect: '/plugins/google-calendar/disconnect',
      calendars: '/plugins/google-calendar/calendars',
      calendarsRefresh: '/plugins/google-calendar/calendars/refresh',
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
    const finalAnswer = { ...v1, protocolVersion: 3,
      event: { type: 'delta', text: 'Your calendars are…', reset: true } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(finalAnswer)}`)).toEqual(finalAnswer);
    expect(() => parseCalendarCompatibleFrame(`data: ${JSON.stringify({ ...finalAnswer,
      event: { ...finalAnswer.event, reset: 'yes' } })}`)).toThrow();

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

  it('accepts no-ID v2 status and independent default CAS without enablement', () => {
    expect(isCalendarPublicStatus(multiStatus())).toBe(true);
    expect(
      isCalendarSettingsRequest({
        defaultSetting: {
          calendarId: 'team@example.com',
          expectedRevision: 7,
          expectedConnectionRevision: 3,
        },
      }),
    ).toBe(true);
    expect(
      isCalendarSettingsRequest({
        defaultSetting: {
          calendarId: null,
          expectedRevision: 7,
          expectedConnectionRevision: 3,
        },
      }),
    ).toBe(true);
    expect(isCalendarSettingsRequest({})).toBe(false);
    expect(
      isCalendarSettingsRequest({
        defaultSetting: {
          calendarId: 'primary',
          expectedRevision: 7,
          expectedConnectionRevision: 3,
        },
      }),
    ).toBe(false);
    expect(isCalendarSettingsRequest({ enabled: true, userId: 'spoof' })).toBe(false);
    expect(isCalendarPublicStatus({ ...multiStatus(), accessToken: 'secret' })).toBe(false);
  });

  it('bounds pages without confusing snapshot completeness with page continuation', () => {
    expect(isCalendarCalendarsResponse(calendarPage({ nextPageToken: 'signed.opaque' }))).toBe(true);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          complete: false,
          truncated: true,
          limitations: ['calendar-limit', 'primary-missing'],
        }),
      ),
    ).toBe(true);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: Array.from({ length: 21 }, (_, i) =>
            calendarEntry({ calendarId: `cal-${i}` }),
          ),
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: [calendarEntry(), calendarEntry()],
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: [
            calendarEntry({
              accessRole: 'reader',
              privateAccess: false,
              capabilities: { readEvents: true, createEvents: true, availability: true },
            }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it('enforces comprehensive boundaries on roles, scopes, revisions, tokens, and byte caps', () => {
    // Refresh request boundary
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: 3 })).toBe(true);
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: 0 })).toBe(false);
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: -1 })).toBe(false);
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: 1.5 })).toBe(false);
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: '3' })).toBe(false);
    expect(isCalendarRefreshRequest({ expectedConnectionRevision: 3, extra: true })).toBe(false);

    // All five roles with valid configurations
    const ownerEntry = calendarEntry({ accessRole: 'owner', privateAccess: true });
    const writerEntry = calendarEntry({ accessRole: 'writer', privateAccess: true });
    const writerMasked = calendarEntry({
      accessRole: 'writerWithoutPrivateAccess',
      privateAccess: false,
    });
    const readerEntry = calendarEntry({
      accessRole: 'reader',
      privateAccess: false,
      capabilities: { readEvents: true, createEvents: false, availability: true },
    });
    const freeBusyEntry = calendarEntry({
      accessRole: 'freeBusyReader',
      privateAccess: false,
      capabilities: { readEvents: false, createEvents: false, availability: true },
    });
    expect(isCalendarCalendarsResponse(calendarPage({ calendars: [ownerEntry] }))).toBe(true);
    expect(isCalendarCalendarsResponse(calendarPage({ calendars: [writerEntry] }))).toBe(true);
    expect(isCalendarCalendarsResponse(calendarPage({ calendars: [writerMasked] }))).toBe(true);
    expect(isCalendarCalendarsResponse(calendarPage({ calendars: [readerEntry] }))).toBe(true);
    expect(isCalendarCalendarsResponse(calendarPage({ calendars: [freeBusyEntry] }))).toBe(true);

    // Invalid role/capability combinations
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: [calendarEntry({ accessRole: 'writerWithoutPrivateAccess', privateAccess: true })],
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: [
            calendarEntry({
              accessRole: 'freeBusyReader',
              privateAccess: false,
              capabilities: { readEvents: true, createEvents: false, availability: true },
            }),
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          calendars: [
            calendarEntry({
              hidden: true,
              capabilities: { readEvents: true, createEvents: false, availability: false },
            }),
          ],
        }),
      ),
    ).toBe(false);

    // Status v2 edge cases: null discovery, null default, missingScopes validation
    expect(
      isCalendarPublicStatus(
        multiStatus({
          discovery: null,
          defaultSetting: null,
          connectionRevision: null,
          primaryCalendarId: null,
        }),
      ),
    ).toBe(true);
    expect(
      isCalendarPublicStatus(
        multiStatus({
          state: 'setup-required',
          missingScopes: ['https://www.googleapis.com/auth/calendar.events'],
        }),
      ),
    ).toBe(true);
    expect(
      isCalendarPublicStatus(
        multiStatus({
          state: 'connected',
          missingScopes: ['https://www.googleapis.com/auth/calendar.events'],
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarPublicStatus(
        multiStatus({
          state: 'setup-required',
          missingScopes: Array.from({ length: 6 }, (_, i) => `scope-${i}`),
        }),
      ),
    ).toBe(false);
    expect(isCalendarPublicStatus(multiStatus({ connectionRevision: 0 }))).toBe(false);
    expect(isCalendarPublicStatus(multiStatus({ connectionRevision: -2 }))).toBe(false);
    expect(isCalendarPublicStatus(multiStatus({ connectionRevision: 1.2 }))).toBe(false);

    // Page: tokens, labels, control characters, dates, and byte limits
    const token2048 = 'a'.repeat(2048);
    const token2049 = 'a'.repeat(2049);
    expect(isCalendarCalendarsResponse(calendarPage({ nextPageToken: token2048 }))).toBe(true);
    expect(isCalendarCalendarsResponse(calendarPage({ nextPageToken: token2049 }))).toBe(false);

    const label200 = 'x'.repeat(200);
    const label201 = 'x'.repeat(201);
    expect(
      isCalendarCalendarsResponse(calendarPage({ calendars: [calendarEntry({ label: label200 })] })),
    ).toBe(true);
    expect(
      isCalendarCalendarsResponse(calendarPage({ calendars: [calendarEntry({ label: label201 })] })),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({ calendars: [calendarEntry({ label: 'team\u0000bad' })] }),
      ),
    ).toBe(false);

    // Lifetime bounds: <= 300,000ms
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          fetchedAt: '2026-10-24T10:00:00.000Z',
          expiresAt: '2026-10-24T10:06:00.000Z',
        }),
      ),
    ).toBe(false); // 360,000ms > 300,000ms
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          fetchedAt: '2026-10-24T10:05:00.000Z',
          expiresAt: '2026-10-24T10:00:00.000Z',
        }),
      ),
    ).toBe(false); // expires before fetched

    // Multibyte cap (> 15360 bytes despite fewer characters)
    // 20 entries with large labels: 20 * 50 rockets = 20 * 200 bytes = 4000 bytes.
    // Let's create calendars that exceed 15360 bytes
    const bigEntries = Array.from({ length: 20 }, (_, i) =>
      calendarEntry({
        calendarId: `cal-${'x'.repeat(500)}-${i}@example.com`,
        label: '🚀'.repeat(50),
        timeZone: 'Europe/London',
      }),
    );
    const bigResponse = calendarPage({ calendars: bigEntries });
    const encoded = new TextEncoder().encode(JSON.stringify(bigResponse.page)).byteLength;
    if (encoded > 15360) {
      expect(isCalendarCalendarsResponse(bigResponse)).toBe(false);
    }
  });

  it('parses v3 clarification and target receipts while enforcing versioned envelopes', () => {
    const envelope = {
      protocolVersion: 3,
      sessionId: 'session-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      sequence: 2,
      event: clarification(),
    };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(envelope)}`)).toEqual(envelope);
    const withRevision = { ...envelope, event: { ...clarification(), proposalRevision: 3 } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(withRevision)}`)).toEqual(withRevision);
    for (const proposalRevision of [0, -1, 1.5, '3', null]) {
      expect(() => parseCalendarCompatibleFrame(`data: ${JSON.stringify({ ...envelope,
        event: { ...clarification(), proposalRevision },
      })}`)).toThrow('invalid_stream_envelope');
    }
    expect(isCalendarTurnState(createdOperation())).toBe(true);
    expect(() =>
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          protocolVersion: 2,
        })}`,
      ),
    ).toThrow('invalid_stream_envelope');
    expect(
      isCalendarTurnState({
        ...createdOperation(),
        receipt: {
          ...createdOperation().receipt!,
          expiresAt: null,
        },
      }),
    ).toBe(false);
    expect(() =>
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          event: { ...clarification(), confirmed: true },
        })}`,
      ),
    ).toThrow('invalid_stream_envelope');

    // 20 candidates is allowed, 21 is rejected
    const cand20 = Array.from({ length: 20 }, (_, i) => ({
      calendarId: `cal-${i}@example.com`,
      label: `Cal ${i}`,
      role: 'writer' as const,
    }));
    expect(
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          event: { ...clarification(), candidates: cand20 },
        })}`,
      ),
    ).toBeDefined();

    const cand21 = Array.from({ length: 21 }, (_, i) => ({
      calendarId: `cal-${i}@example.com`,
      label: `Cal ${i}`,
      role: 'writer' as const,
    }));
    expect(() =>
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          event: { ...clarification(), candidates: cand21 },
        })}`,
      ),
    ).toThrow('invalid_stream_envelope');

    // Failed / cancelled operation without receipt is valid in v2 turn state
    const failedOp = {
      schemaVersion: 2 as const,
      operationId: 'op-failed-1',
      state: 'failed' as const,
      narration: 'failed' as const,
      retryAction: 'none' as const,
      receipt: null,
    };
    expect(isCalendarTurnState(failedOp)).toBe(true);

    const cancelledOp = {
      schemaVersion: 2 as const,
      operationId: 'op-cancelled-1',
      state: 'cancelled' as const,
      narration: 'interrupted' as const,
      retryAction: 'resume-reconciliation' as const,
      receipt: null,
    };
    expect(isCalendarTurnState(cancelledOp)).toBe(true);

    // Missing schemaVersion in v3 operation
    const opMissingSchema = {
      type: 'calendar-operation',
      operation: { ...failedOp, schemaVersion: undefined },
    };
    expect(() =>
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          event: opMissingSchema,
        })}`,
      ),
    ).toThrow('invalid_stream_envelope');

    // Oversized message > 1000 characters
    expect(() =>
      parseCalendarCompatibleFrame(
        `data: ${JSON.stringify({
          ...envelope,
          event: { ...clarification(), message: 'a'.repeat(1001) },
        })}`,
      ),
    ).toThrow('invalid_stream_envelope');

    // Frame byte cap > 16384 bytes
    const hugeMessageEnvelope = {
      ...envelope,
      event: {
        ...clarification(),
        candidates: Array.from({ length: 20 }, (_, i) => ({
          calendarId: `cal-${'x'.repeat(400)}-${i}@example.com`,
          label: `Label ${i}`,
          role: 'writer' as const,
        })),
      },
    };
    if (new TextEncoder().encode(JSON.stringify(hugeMessageEnvelope)).byteLength > 16384) {
      expect(() =>
        parseCalendarCompatibleFrame(`data: ${JSON.stringify(hugeMessageEnvelope)}`),
      ).toThrow('invalid_stream_envelope');
    }
  });

  it('accepts bounded P1 views and protocol-3 view frames, not malformed or oversized facts', () => {
    for (const view of [agenda(), proposal(), outcome(), notice()]) {
      expect(isCalendarView(view)).toBe(true);
      expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify({protocolVersion:3,sessionId:'s',turnId:'t',
        attemptId:'a',sequence:0,event:{type:'calendar-view',view}})}`).event.type).toBe('calendar-view');
    }
    expect(isCalendarView({...agenda(),entries:Array(21).fill(agenda().entries[0])})).toBe(false);
    expect(isCalendarView({...agenda(),truncated:false,nextPageToken:'more'})).toBe(false);
    expect(isCalendarView({...agenda(),extra:true})).toBe(false);
    expect(isCalendarView({...outcome(),state:'unknown'})).toBe(false);
    expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],allDay:true,
      start:'2026-11-12',end:'2026-11-11'}]})).toBe(false);
    expect(isCalendarView({...agenda(),entries:Array.from({length:20},(_,i)=>({...agenda().entries[0],
      eventId:`event-${i}`,description:'🙂'.repeat(500)}))})).toBe(false);
  });

  it('accepts P1 optional references and distinguishes invalid data from absent optional facts',()=>{
    const p=proposal();
    const clarification={type:'calendar-clarification',proposalId:p.proposalId,proposalRevision:p.revision,
      expiresAt:p.expiresAt,reason:p.reason,message:'Review the event.',candidates:[],view:p};
    expect(isCalendarPresentationEvent(clarification)).toBe(true);
    const o=outcome();
    expect(isCalendarPresentationEvent({type:'calendar-operation',operation:{schemaVersion:2,operationId:o.operationId,
      proposalId:o.proposalId,intentId:o.intentId,state:o.state,narration:'completed',retryAction:o.retryAction,receipt:o.receipt}})).toBe(true);
    expect(isCalendarView({...agenda(),requested:null})).toBe(true);
    expect(isCalendarView({...agenda(),requested:{...agenda().requested!,displayTimeZone:'Invalid/Zone'}})).toBe(false);
    expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],allDay:true,start:'2026-02-30',end:'2026-03-03'}]})).toBe(false);
    expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],htmlLink:'javascript:alert(1)'}]})).toBe(false);
  });
});
