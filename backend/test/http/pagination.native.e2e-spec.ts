/**
 * ============================================================================
 * FILE: pagination.native.e2e-spec.ts
 * LOCATION: backend/test/http/pagination.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove stable session ties, older message pages, and scoped cursors.
 *
 * ROLE IN PROJECT:
 *    Uses real P2 repositories through HTTP so pagination order and foreign
 *    cursor rejection stay repository-owned rather than re-sorted in P6.
 *
 * KEY COMPONENTS:
 *    - Session pages: Activity-desc then session-id-desc ties.
 *    - Message pages: Newest ascending window, then older pages.
 *    - Scope tests: Foreign content and malformed cursors stay 400/isolated.
 * ============================================================================
 */

import request from 'supertest';
import { nativeHarness } from '../runtime/native-harness.js';
import { httpHarness } from './http-harness.js';
import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { session,message } from '../persistence/fixtures.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('HTTP pagination native scope', () => {
  it('pages stable same-time session ties and older messages with no duplicates or scope leaks',async () => {
    const h = await nativeHarness(); let http:Awaited<ReturnType<typeof httpHarness>> | undefined;
    try {
      const u = h.identity.userId;
      for (const s of ['s1','s2','s3']) await h.persistence.sessions.createIfAbsent({ ...session(u,s),latestTurnId:'t1' });
      await h.persistence.sessions.createIfAbsent({ ...session('foreign','s1'),latestTurnId:'t1' });
      for (const n of [0,1,2,3,4]) await h.persistence.messages.append(message(n,u,'s1'));
      await h.persistence.messages.append({ ...message(99,'foreign','s1'),content:'foreign secret' });
      http = await httpHarness({ runtime:createChatRuntime(h.deps),sessions:h.persistence.sessions,messages:h.persistence.messages,
        identity:new ServerIdentityResolver(h.deps.config),budgets:h.deps.config.budgets });
      const api = request(http.app.getHttpServer());
      let cursor:string | null = null; const seen:string[] = [];
      do {
        const page:request.Response = await api.get('/api/sessions').query({ limit:2,...(cursor ? { cursor } : {}) }).expect(200);
        seen.push(...page.body.items.map((s:{ sessionId:string }) => s.sessionId)); cursor = page.body.nextCursor;
      } while (cursor);
      expect(seen).toEqual(['s3','s2','s1']); expect(new Set(seen).size).toBe(3);
      const newest = await api.get('/api/sessions/s1/messages?limit=2').expect(200);
      expect(newest.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([3,4]);
      expect(newest.body.olderAvailable).toBe(true);
      const older = await api.get('/api/sessions/s1/messages').query({ limit:2,cursor:newest.body.nextCursor }).expect(200);
      expect(older.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([1,2]);
      const oldest = await api.get('/api/sessions/s1/messages').query({ limit:2,cursor:older.body.nextCursor }).expect(200);
      expect(oldest.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([0]);
      expect(oldest.body.olderAvailable).toBe(false);
      expect(JSON.stringify([newest.body,older.body,oldest.body])).not.toContain('foreign secret');
      await api.get('/api/sessions/s2/messages').query({ cursor:newest.body.nextCursor }).expect(400);
      await api.get('/api/sessions?cursor=malformed').expect(400);
    } finally { if (http) await http.close(); await h.close(); }
  },30000);
});
