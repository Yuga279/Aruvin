import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarClient } from '../../../api/calendar-client.ts';
import type { CalendarPublicStatus } from '../../../api/calendar-protocol.ts';
import { GoogleCalendarPanel } from './GoogleCalendarPanel.tsx';
import { multiStatus } from './testing/multi-calendar-fixtures.ts';

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

  it('offers Connect without a target ID while retaining operator processing setup', () => {
    const status = multiStatus({
      state: 'setup-required',
      enabled: true,
      accountEmail: null,
      connectionRevision: null,
      defaultSetting: null,
      primaryCalendarId: null,
      discovery: null,
    });
    const html = renderToStaticMarkup(
      createElement(GoogleCalendarPanel, {
        client: mockClient(status),
        initialStatus: status,
      }),
    );
    expect(html).toContain('Connect Google Calendar');
    expect(html).not.toMatch(/disabled=""[^>]*>Connect Google Calendar/);
    expect(html).not.toContain('disposable owned target calendar ID');
    expect(html).not.toContain('Not configured on server');
    expect(html).toContain('approved processing policy');
  });

  it('renders the connected v2 panel heading the browser fixture looks for', () => {
    const status = multiStatus({
      accountEmail: 'operator@example.com',
      defaultSetting: {
        defaultCalendarId: 'primary@example.com',
        defaultSettingRevision: 7,
      },
      primaryCalendarId: 'primary@example.com',
    });
    const html = renderToStaticMarkup(
      createElement(GoogleCalendarPanel, {
        client: mockClient(status),
        initialStatus: status,
      }),
    );
    expect(html).toContain('Connected Google account');
    expect(html).toContain('Google Calendar (embedded MCP)');
  });
});
