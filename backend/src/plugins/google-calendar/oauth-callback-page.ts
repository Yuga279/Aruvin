/**
 * ============================================================================
 * FILE: oauth-callback-page.ts
 * LOCATION: backend/src/plugins/google-calendar/oauth-callback-page.ts
 * ============================================================================
 * PURPOSE: Serve a static same-origin Calendar OAuth completion document.
 * ROLE IN PROJECT: Bridges Google's cross-site redirect onto Aurvin origin so
 * Strict auth cookies can finish the owner's pending OAuth flow.
 * KEY COMPONENTS: oauthCallbackPage, oauthCallbackCsp.
 * ============================================================================
 */

import { createHash } from 'node:crypto';

const completionScript = `(async () => {
  const rawQuery = location.search.slice(1);
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/api/plugins/google-calendar/oauth/complete', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Aurvin-Calendar-CSRF': '1' },
      body: JSON.stringify({ rawQuery })
    });
    if (!r.ok) throw new Error('Calendar setup failed');
    const result = await r.json();
    if (!['connected', 'fixture', 'cancelled', 'failed'].includes(result.outcome)) throw new Error('Calendar setup failed');
    location.replace('/?plugin=google-calendar&oauth=' + encodeURIComponent(result.outcome));
  } catch { document.getElementById('status').textContent = 'Sign in to Aurvin and start the Calendar connection again.'; }
})();`;
export function oauthCallbackCsp(): string {
  const hash = createHash('sha256').update(completionScript).digest('base64');
  return `default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`;
}
export function oauthCallbackPage(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Completing Calendar connection</title><p id="status">Completing Calendar connection…</p>
<script>${completionScript}</script>`;
}
