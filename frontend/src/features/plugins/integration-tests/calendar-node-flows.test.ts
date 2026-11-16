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
    disconnect: vi.fn(async () => ({
      disconnected: true as const,
      remoteRevocation: 'not-requested' as const,
    })),
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
