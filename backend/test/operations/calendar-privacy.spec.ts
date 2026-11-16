import { Telemetry } from '../../src/operations/telemetry.js';

it('logs Calendar correlation without secrets, titles, or callback query values', () => {
  const logs: string[] = [];
  const telemetry = new Telemetry(line => logs.push(line));
  telemetry.inRequest('00000000-0000-4000-8000-000000000001', () =>
    telemetry.inTurn({ sessionId: 's', turnId: 't', attemptId: 'a' }, () =>
      telemetry.event('calendar', { phase: 'executing', operationId: 'op',
        token: 'fixture-refresh-secret', code: 'untrusted-event-title',
        url: '?code=fixture-oauth-code', description: 'private-event-description',
        calendarId: 'private-calendar@example.invalid', calendarLabel: 'Private work name',
        proposalId: 'private-proposal-label', busy: [{ start: 'private-busy-value' }],
      })));
  const text = logs.join('\n');
  expect(text).toContain('00000000-0000-4000-8000-000000000001');
  expect(text).toContain('executing');
  expect(text).not.toMatch(/fixture-refresh-secret|fixture-oauth-code|private-event-description|untrusted-event-title/);
  expect(text).not.toMatch(/private-calendar|Private work name|private-proposal-label|private-busy-value/);
  expect(JSON.parse(logs[0]).operationId).toMatch(/^h:[a-f0-9]{24}$/);
});
