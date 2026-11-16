/**
 * ============================================================================
 * FILE: verify-email-oauth-scope.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/verify-email-oauth-scope.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Simulate exact Google OAuth token exchange payload to verify that
 *    'https://www.googleapis.com/auth/userinfo.email' is correctly canonicalized
 *    to 'email' and admitted without 'reconnect-required' or 'missingScopes'.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { GoogleCalendarOAuthClient } from '../../../src/plugins/google-calendar/oauth-client.js';
import { parseCalendarSetupOptions } from '../../../src/plugins/google-calendar/options.js';
import { calendarGrantStatus } from '../../../src/contracts/calendar-policy.js';

describe('Google OAuth Email Scope Canonicalization Verification', () => {
  it('successfully exchanges and canonicalizes userinfo.email from Google token endpoint', async () => {
    // Exact scopes string returned by Google OAuth in production
    const googleReturnedScopeString = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
    ].join(' ');

    const mockGoogleTokenResponse = {
      access_token: 'mock_google_access_token_12345',
      refresh_token: 'mock_google_refresh_token_67890',
      id_token: 'mock_google_id_token_abcde',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: googleReturnedScopeString,
    };

    const setupOptions = parseCalendarSetupOptions({
      initial: { enabled: true, processingPolicyId: 'local-test-policy' },
      oauth: {
        clientId: 'mock-client-id.apps.googleusercontent.com',
        clientSecret: 'mock-client-secret',
        redirectUri: 'http://localhost:8001/api/plugins/google-calendar/oauth/callback',
      },
      frontendOrigin: 'http://localhost:5179',
      backendOrigin: 'http://localhost:8001',
      evidence: 'google',
      realDataPolicyApproved: true,
    });

    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify(mockGoogleTokenResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new GoogleCalendarOAuthClient({
      options: setupOptions,
      fetch: mockFetch,
      now: () => Date.now(),
    });

    // Perform token exchange
    const grant = await client.exchange({
      code: 'mock_auth_code_from_google',
      verifier: 'a'.repeat(43),
      signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 10000).toISOString(),
    });

    // Assert that 'https://www.googleapis.com/auth/userinfo.email' was mapped to 'email'
    expect(grant.scopes).toContain('email');
    expect(grant.scopes).not.toContain('https://www.googleapis.com/auth/userinfo.email');

    // Assert that grant status is complete with 0 missing scopes
    const status = calendarGrantStatus(grant.scopes);
    expect(status.state).toBe('complete');
    expect(status.missingScopes).toHaveLength(0);
  });
});
