/**
 * ============================================================================
 * FILE: session-actions.spec.ts
 * LOCATION: backend/test/http/session-actions.spec.ts
 * ============================================================================
 * PURPOSE: Verify validated, ownership-scoped session management commands.
 * ROLE IN PROJECT: Deterministic HTTP service checks without live Mongo or providers.
 * KEY COMPONENTS: Rename/pin validation, deletion delegation, archived-read denial.
 * ============================================================================
 */
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions } from './fixtures.js';
import { session } from '../persistence/fixtures.js';

describe('session actions', () => {
  it('scopes rename and pin updates to server identity', async () => {
    const options = fixtureOptions();
    const service = new ChatHttpService(options);
    await service.updateSession('s1', { title: '  New name  ', pinned: true });
    expect(options.sessions.update).toHaveBeenCalledWith('server-user', 's1', { title: 'New name', pinned: true });
    await service.deleteSession('s1');
    expect(options.sessions.delete).toHaveBeenCalledWith('server-user', 's1');
  });
  it.each([{}, { title: ' ' }, { title: 'x'.repeat(81) }, { pinned: 'yes' }, { userId: 'other', title: 'Name' }])(
    'rejects invalid or client-identity updates %j', async body => {
      const options = fixtureOptions();
      await expect(new ChatHttpService(options).updateSession('s1', body)).rejects.toBeDefined();
      expect(options.sessions.update).not.toHaveBeenCalled();
    });
  it('hides deleted sessions and their transcript', async () => {
    const options = fixtureOptions();
    options.sessions.get = vi.fn(async () => ({ ...session('server-user', 's1'), lifecycle: 'archived' as const }));
    const service = new ChatHttpService(options);
    await expect(service.session('s1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.messages('s1', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(options.messages.list).not.toHaveBeenCalled();
  });
});
