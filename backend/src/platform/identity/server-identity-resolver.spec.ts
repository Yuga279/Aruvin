/**
 * ============================================================================
 * FILE: server-identity-resolver.spec.ts
 * LOCATION: backend/src/platform/identity/server-identity-resolver.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify admitted-store identity resolution and client override rejection.
 *
 * ROLE IN PROJECT:
 *    Ensures the same trusted request identity is used for durable ownership
 *    and OpenRouter attribution, never accepting arbitrary client identity inputs.
 *
 * KEY COMPONENTS:
 *    - Resolution tests: Resolve only inside an admitted store run.
 *    - Override tests: Reject identity, model, and key fields with safe errors.
 * ============================================================================
 */

import { AppError } from '../errors/app-error.js';
import { RequestIdentityStore } from './request-identity-store.js';
import { ServerIdentityResolver } from './server-identity-resolver.js';
import { principal } from '../../../test/assembly/auth-principal-fixture.js';

describe('ServerIdentityResolver', () => {
  it('returns the admitted request identity for OpenRouter user attribution', () => {
    const store = new RequestIdentityStore();
    const resolver = new ServerIdentityResolver(store);
    expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
    expect(store.run(principal('aurvin-dev-user'), () => resolver.resolve())).toEqual({
      userId: 'aurvin-dev-user',
      source: 'authenticated-session',
      openRouterUser: 'aurvin-dev-user',
    });
  });

  it('does not read identity from a request body', () => {
    const store = new RequestIdentityStore();
    const resolver = new ServerIdentityResolver(store);
    const body = { userId: 'attacker', content: 'Hello' };
    store.run(principal(), () => {
      expect(() => resolver.assertNoClientOverrides(body)).toThrow(AppError);
      expect(resolver.resolve()).toMatchObject({ userId: 'u1' });
    });
  });

  it('rejects model and apiKey overrides', () => {
    const store = new RequestIdentityStore();
    const resolver = new ServerIdentityResolver(store);
    store.run(principal(), () => {
      expect(() => resolver.assertNoClientOverrides({ model: 'other' })).toThrow(
        AppError,
      );
      try {
        resolver.assertNoClientOverrides({ apiKey: 'sk-test' });
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('MODEL_OVERRIDE_REJECTED');
      }
    });
  });

  it('never resolves a default owner outside an admitted store run', () => {
    const store = new RequestIdentityStore();
    const resolver = new ServerIdentityResolver(store);
    expect(() => resolver.resolve()).toThrow('UNAUTHENTICATED');
    expect(store.run(principal('test-user-a'), () => resolver.resolve().userId)).toBe('test-user-a');
    expect(store.run(principal('test-user-a'), () => resolver.resolve().openRouterUser)).toBe('test-user-a');
  });
});
