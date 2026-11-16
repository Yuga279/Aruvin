/**
 * ============================================================================
 * FILE: assets.spec.ts
 * LOCATION: backend/test/operations/assets.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assert staging gateway, runbook, and evidence-ledger source consistency.
 *
 * ROLE IN PROJECT:
 *    Checks P8-owned assets without running NGINX, restore, or deployment
 *    measurements that remain P10 evidence work.
 *
 * KEY COMPONENTS:
 *    - Gateway directives: Loopback TLS, auth, streaming, no-cache, no access logs.
 *    - OPS IDs: Runbook and ledger names match; drills stay not-run.
 * ============================================================================
 */

import { readFile } from 'node:fs/promises';
const root=new URL('../../../',import.meta.url);
it('prepares authenticated streaming gateway for both UI/API with no cache or access payload logs', async () => {
  const config=await readFile(new URL('deployment/staging/nginx.conf',root),'utf8');
  for (const directive of ['listen 127.0.0.1:8443 ssl','auth_basic_user_file',
    'proxy_buffering off','proxy_cache off','proxy_read_timeout 240s','proxy_send_timeout 240s',
    'access_log off','Cache-Control "no-store, no-transform"','proxy_pass http://127.0.0.1:3000'])
    expect(config).toContain(directive);
  expect(config).not.toContain('auth_basic off');
  expect(config).not.toContain('listen 0.0.0.0');
});
it('names every required measured drill without claiming external evidence passed', async () => {
  const runbook=await readFile(new URL('docs/aurvin-phase-1/operations.md',root),'utf8');
  const evidence=await readFile(new URL('docs/aurvin-phase-1/staging-evidence.md',root),'utf8');
  for (const id of ['OPS-01','OPS-02','OPS-03','OPS-04','OPS-05','OPS-06','OPS-07','OPS-08','OPS-09','OPS-10']) {
    expect(runbook).toContain(id); expect(evidence).toContain(id);
  }
  expect(runbook).toContain('no independent TTL');
  expect(evidence).toContain('P10'); expect(evidence).toContain('not run');
  expect(evidence).toContain('Unified review: skipped');
});
