/**
 * ============================================================================
 * FILE: service.spec.ts
 * LOCATION: backend/test/http/service.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify scoped reads and trusted runtime command delegation.
 *
 * ROLE IN PROJECT:
 *    Proves first-input acceptance, 404 scoping, sanitized status errors, and
 *    that HTTP never infers or creates sessions from navigation.
 *
 * KEY COMPONENTS:
 *    - Submit tests: Identity forwarding and input bound mapping.
 *    - Read tests: Session/message projections without foreign access.
 *    - Command tests: Retry, cancel, and privileged-field rejection.
 * ============================================================================
 */

import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions, submission, ids } from './fixtures.js';
import { session } from '../persistence/fixtures.js';
import { AppError } from '../../src/platform/errors/app-error.js';
it('creates only on first input and delegates trusted identity without inference', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  expect(await s.submit(null, submission)).toEqual(ids);
  expect(o.runtime.submitTurn).toHaveBeenCalledWith({ ...submission, identity:o.identity.resolve() });
  expect(o.runtime.executeTurn).not.toHaveBeenCalled();
  expect(o.sessions.createIfAbsent).not.toHaveBeenCalled();
  await expect(s.submit('different', { ...submission, sessionId:'s1' })).rejects.toMatchObject({ code:'INVALID_REQUEST' });
  await expect(s.submit(null, { ...submission, content:'😀'.repeat(17000) })).rejects.toMatchObject({ code:'INPUT_TOO_LARGE' });
});
it('projects reads and scopes both missing and foreign sessions to 404', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  const summary = await s.session('s1');
  expect(Object.keys(summary).sort()).toEqual(['createdAt','lastActivityAt','sessionId','title']);
  await s.sessions({ limit:'2' }); await s.messages('s1',{ limit:'1' });
  expect(o.sessions.list).toHaveBeenCalledWith('server-user',{ cursor:null, limit:2 });
  expect(o.messages.list).toHaveBeenCalledWith('server-user','s1',{ cursor:null, limit:1 });
  vi.mocked(o.sessions.get).mockResolvedValueOnce(null);
  await expect(s.messages('foreign',{})).rejects.toMatchObject({ code:'NOT_FOUND' });
  expect(o.messages.list).toHaveBeenCalledTimes(1);
});
it('delegates retry/cancel/status, sanitizes nested errors, and rejects privileged fields', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  await s.retry('s1','t1',{ idempotencyKey:'retry-0001' });
  await s.cancel('s1','t1',{ attemptId:'a1' });
  expect(o.runtime.cancelTurn).toHaveBeenCalledWith({ identity:o.identity.resolve(), sessionId:'s1', turnId:'t1', attemptId:'a1' });
  vi.mocked(o.runtime.getTurnStatus).mockResolvedValueOnce({ sessionId:'s1',turnId:'t1',attemptId:'a1',
    status:'failed',truncated:false,error:{ code:'PROVIDER_ERROR',message:'sk-private graph prompt',retryable:false } });
  expect(JSON.stringify(await s.status('s1','t1'))).not.toMatch(/sk-private|graph prompt/);
  await expect(s.retry('s1','t1',{ idempotencyKey:'retry-0001', role:'system' })).rejects.toMatchObject({ code:'UNKNOWN_FIELD' });
  expect(o.runtime.reconcileSession).not.toHaveBeenCalled();
});
it('serves a public hot stream receipt without a session read', async () => {
  const o = fixtureOptions();
  o.runtime.getStreamAttempt = vi.fn(async () => ({ sessionId:'s1', turnId:'t1', attemptId:'a1',
    status:'accepted' as const, truncated:false, error:null }));
  const s = new ChatHttpService(o);
  expect(await s.streamStatus('s1','t1')).toMatchObject({ sessionId:'s1', turnId:'t1', status:'accepted' });
  expect(o.sessions.get).not.toHaveBeenCalled();
  expect(o.runtime.getTurnStatus).not.toHaveBeenCalled();
});
it.each([
  ['archived', { ...session('server-user','s1'), lifecycle:'archived' as const }],
  ['missing', null],
])('refuses a %s session on the cold stream path before turn status', async (_label, record) => {
  const o = fixtureOptions();
  o.runtime.getStreamAttempt = vi.fn(async () => null);
  o.sessions.get = vi.fn(async () => record);
  const s = new ChatHttpService(o);
  await expect(s.streamStatus('s1','t1')).rejects.toMatchObject({ code:'NOT_FOUND' });
  expect(o.runtime.getTurnStatus).not.toHaveBeenCalled();
});
it('does not attach a public stream to a live receipt', async () => {
  const o = fixtureOptions();
  o.runtime.getStreamAttempt = vi.fn(async () => { throw new AppError('NOT_FOUND','Turn not found.'); });
  const s = new ChatHttpService(o);
  await expect(s.streamStatus('s1','t1')).rejects.toMatchObject({ code:'NOT_FOUND' });
  expect(o.sessions.get).not.toHaveBeenCalled();
  expect(o.runtime.getTurnStatus).not.toHaveBeenCalled();
});
