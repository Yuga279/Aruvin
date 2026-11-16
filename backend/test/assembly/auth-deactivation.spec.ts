/**
 * ============================================================================
 * FILE: auth-deactivation.spec.ts
 * LOCATION: backend/test/assembly/auth-deactivation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify confirmed deactivation stops one owner without process shutdown.
 *
 * ROLE IN PROJECT:
 *    Connects P2's local invalidation hook to existing cleanup ports so a
 *    cleanup failure cannot undo deactivation or disturb another owner.
 *
 * KEY COMPONENTS:
 *    - Confirmed inactive status and cookie rejection after cleanup throws.
 *    - Targeted interruptUser/stopUser without stopAccepting.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { account, authFixture } from '../auth/fixtures.js';
import { principal } from './auth-principal-fixture.js';

it('keeps confirmed deactivation authoritative despite cleanup failure and leaves other owners alone', async () => {
  const f = assemblyFixture();
  const auth = await authFixture(account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' }));
  const admin = principal('admin', 'super-admin');
  await auth.users.insert({ ...admin.account });
  Object.assign(f.bundle, { users: auth.users });
  const interrupted = vi.fn(async (_userId: string) => { throw new Error('fixture cleanup uncertainty'); });
  Object.assign(f.raw, { interruptUser: interrupted });
  const identities = new RequestIdentityStore(), identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, { ...f.ports, identities, identity,
    authProvider: () => auth.provider });
  const voice = vi.spyOn(service.voiceSessions, 'stopUser');
  try {
    await service.administration.deactivate(admin, 'u1', {});
    expect((await auth.users.get('u1'))!.account).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
    await expect(service.auth.authenticate('sealed_1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(interrupted.mock.calls.map(c => c[0])).toEqual(['u1']);
    expect(voice).toHaveBeenCalledWith('u1');
    expect(f.raw.stopAccepting).not.toHaveBeenCalled();
    expect(JSON.stringify(f.logs)).not.toContain('fixture cleanup uncertainty');
  } finally { await service.operations.shutdown(); }
});
