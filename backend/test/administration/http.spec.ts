/**
 * ============================================================================
 * FILE: http.spec.ts
 * LOCATION: backend/test/administration/http.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify all five Administration routes against the frozen P1 wire.
 *
 * ROLE IN PROJECT:
 *    Exercises actual routing, role denial and secret-free filters.
 *    Checks isolated module behavior before P3 root integration.
 *
 * KEY COMPONENTS:
 *    - HTTP success, direct API denials and safe error serialization.
 * ============================================================================
 */
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { isAdministrationErrorResponse, isAdministrationPage,
  isAdministrationUserResponse } from '../../src/contracts/administration.js';
import { administrationHttpFixture } from './http-fixture.js';

it('exposes list/create/deactivate/reactivate/reset with the agreed response shapes', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    const list = await request(server).get('/api/admin/users?limit=1').expect(200);
    expect(isAdministrationPage(list.body)).toBe(true); expect(list.body.items).toHaveLength(1);
    const created = await request(server).post('/api/admin/users').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'user' }).expect(201);
    expect(isAdministrationUserResponse(created.body)).toBe(true);
    const disabled = await request(server).post('/api/admin/users/u1/deactivate').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(200);
    expect(disabled.body.user.status).toBe('inactive');
    const enabled = await request(server).post('/api/admin/users/u1/reactivate').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(200);
    expect(enabled.body.user.status).toBe('active');
    const reset = await request(server).post('/api/admin/users/u1/password-reset').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').send({}).expect(204);
    expect(reset.text).toBe(''); expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
    expect(JSON.stringify([list.body, created.body, disabled.body, enabled.body])).not.toContain('temporary-secret');
  } finally { await f.app.close(); }
});
it('returns 401/403 through every direct API route, regardless of client role hints', async () => {
  const f = await administrationHttpFixture();
  try {
    for (const principal of [null, f.regular]) {
      f.as(principal); const status = principal ? 403 : 401; const server = f.app.getHttpServer();
      const list = await request(server).get('/api/admin/users').set('Host', 'localhost:3000').set('X-Role', 'super-admin').expect(status);
      expect(isAdministrationErrorResponse(list.body)).toBe(true);
      await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
        .send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'user' }).expect(status);
      for (const action of ['deactivate', 'reactivate', 'password-reset'])
        await request(server).post(`/api/admin/users/u1/${action}`).set('Host', 'localhost:3000')
          .set('Origin', 'http://localhost:5173').send({}).expect(status);
    }
    expect(f.provider.createUser).not.toHaveBeenCalled(); expect(f.provider.sendRecovery).not.toHaveBeenCalled();
    expect((await f.users.get('u1'))?.account.status).toBe('active');
  } finally { await f.app.close(); }
});
it('rejects extra/duplicate queries, role escalation and Super Admin lifecycle targets', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    for (const query of ['limit=51', 'limit=1&limit=2', 'cursor=not-json', 'userId=victim'])
      await request(server).get(`/api/admin/users?${query}`).set('Host', 'localhost:3000').expect(400);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .send({ email: 'new@example.com', temporaryPassword: 'temporary-secret', role: 'super-admin' }).expect(400);
    for (const action of ['deactivate', 'reactivate', 'password-reset']) {
      await request(server).post(`/api/admin/users/admin/${action}`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(403);
      const missing = await request(server).post(`/api/admin/users/missing/${action}`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(404);
      expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      await request(server).post(`/api/admin/users/u1/${action}?email=attacker@example.com`).set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:5173').send({}).expect(400);
    }
  } finally { await f.app.close(); }
});
it('never reflects or logs a password/provider-token exception on provisioning failure', async () => {
  const f = await administrationHttpFixture();
  const logs = (['log', 'info', 'warn', 'error'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => undefined));
  try {
    f.provider.createUser.mockRejectedValueOnce(new Error('password-sentinel token-sentinel reset-url-sentinel'));
    const result = await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' }).expect(503);
    expect(result.body).toEqual({ error: { code: 'ACCOUNT_PROVISIONING_INCOMPLETE', retryable: false } });
    for (const word of ['password-sentinel', 'token-sentinel', 'reset-url-sentinel']) expect(result.text).not.toContain(word);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify([...f.documents.values()])).not.toContain('password-sentinel');
  } finally { for (const log of logs) log.mockRestore(); await f.app.close(); }
});
it('normalizes unexpected storage errors to a closed safe HTTP fault', async () => {
  const f = await administrationHttpFixture();
  try {
    vi.spyOn(f.users, 'list').mockRejectedValueOnce(new Error('private-storage-data'));
    const result = await request(f.app.getHttpServer()).get('/api/admin/users').set('Host', 'localhost:3000').expect(503);
    expect(result.body).toEqual({ error: { code: 'NOT_READY', retryable: true } });
    expect(result.text).not.toContain('private-storage-data');
  } finally { await f.app.close(); }
});
