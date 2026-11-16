/**
 * ============================================================================
 * FILE: auth-owners.spec.ts
 * LOCATION: backend/test/voice/session/auth-owners.spec.ts
 * ============================================================================
 * PURPOSE: Bind voice HTTP ownership separately from internal cleanup.
 * ROLE IN PROJECT: Proves DELETE checks the authenticated owner while timers
 * and drain can end a bound entry outside request identity.
 * KEY COMPONENTS: endOwned mismatch; end without ambient resolve.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request } from './fixtures.js';
import { principal } from '../../assembly/auth-principal-fixture.js';
import { RequestIdentityStore } from '../../../src/platform/identity/request-identity-store.js';

it('keeps DELETE owner-checked while internal cleanup works outside request identity', async () => {
  const o = options(), a = principal('u1'), b = principal('u2');
  const identities = new RequestIdentityStore(), resolve = vi.spyOn(identities, 'resolve');
  const service = new VoiceSessionService(o);
  const first = await identities.run(a, () => service.create(request, origin, a));
  try {
    await expect(service.endOwned(first.response.sessionId, b)).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
    expect(service.snapshot().active).toBe(1);
    await service.end(first.response.sessionId);
    expect(service.snapshot().active).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  } finally { await service.drain(); }
});
