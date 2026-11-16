/**
 * ============================================================================
 * FILE: auth-oauth-callback.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/auth-oauth-callback.spec.ts
 * ============================================================================
 * PURPOSE: Prove Calendar OAuth completion stays same-origin and owner-bound.
 * ROLE IN PROJECT: Guards the static callback page, scoped OAuth cookie, and
 * sid mismatch rejection before any code exchange.
 * KEY COMPONENTS: oauthCallbackPage strings; oauthFixture sid mismatch.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { oauthCallbackPage } from '../../../src/plugins/google-calendar/oauth-callback-page.js';
import { oauthCookie, clearOAuthCookie } from '../../../src/plugins/google-calendar/oauth.js';
import { oauthFixture } from './oauth-fixtures.js';

it('uses a static same-origin completion page without reflecting provider query or installing a grant', () => {
  const page = oauthCallbackPage();
  expect(page).toContain("credentials: 'same-origin'");
  expect(page).toContain('/api/plugins/google-calendar/oauth/complete');
  expect(page).toContain('location.search.slice(1)');
  expect(page).toContain('history.replaceState');
  expect(page).not.toContain('document.cookie');
  expect(oauthCookie('a'.repeat(43))).toContain('Path=/api/plugins/google-calendar/oauth;');
  expect(clearOAuthCookie()).toContain('Path=/api/plugins/google-calendar/oauth;');
});

it('rejects a different signed-in session before code exchange and preserves the initiating flow', async () => {
  const f = oauthFixture(), signal = new AbortController().signal;
  const started = await f.oauth.start(signal, 'sid_original');
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const input = { rawQuery: new URLSearchParams({ state, code: 'fixture-code' }).toString(),
    cookieHeader: `aurvin_gcal_oauth=${started.browserCookie}` };
  await expect(f.oauth.callback(input, signal, 'sid_different')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
  f.oauth.cancelPending('sid_different');
  expect((await f.readState())[0]!.consumedAt).toBeNull();
  f.oauth.cancelPending('sid_original');
  await expect(f.oauth.callback(input, signal, 'sid_original')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
});
