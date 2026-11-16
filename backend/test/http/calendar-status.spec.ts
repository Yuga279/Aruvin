import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions } from './fixtures.js';

it('projects durable Calendar turn state through the status route', async () => {
  const o = fixtureOptions();
  const calendar = {
    operationId: 'op1', state: 'succeeded' as const, narration: 'failed' as const,
    retryAction: 'none' as const,
    receipt: { durable: true as const, eventId: 'evt12', htmlLink: null, expiresAt: null },
  };
  o.runtime.getCalendarTurnState = vi.fn(async () => calendar);
  const service = new ChatHttpService(o);
  const status = await service.status('s1', 't1');
  expect(status.calendar).toEqual(calendar);
  expect(o.runtime.getCalendarTurnState).toHaveBeenCalledWith('server-user', 's1', 't1');
});

it('omits Calendar when no turn state exists and does not invent a receipt', async () => {
  const o = fixtureOptions();
  o.runtime.getCalendarTurnState = vi.fn(async () => null);
  const service = new ChatHttpService(o);
  const status = await service.status('s1', 't1');
  expect(status).not.toHaveProperty('calendar');
});
