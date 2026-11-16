# Super-admin configuration operations

Runbook for the database-backed Aurvin settings dashboard. MongoDB's `config` collection is the only runtime source for manageable values; infrastructure and the encryption master key stay environment-only. See [goal](goal.md), [state](state.md), the [root README](../../README.md), and [../README.md](../README.md) for boundaries. Staging, gateway, paid-provider, and Azure checks are not authorized in this workflow; the evidence section below stays **unrun / assigned to P7**.

## 1. New setup

1. Copy `backend/.env.example` to `backend/.env` only when the private file is absent. Never overwrite an existing private file.
2. Privately configure native replica-set infrastructure and the exact frontend origin (`PERSISTENCE_PROFILE=native-mongodb`, `MONGODB_URI`, `MONGODB_DB_NAME`, `FRONTEND_ORIGIN`, single-process topology).
3. Generate one 32-byte master key locally in a private terminal and store it as `AURVIN_CONFIG_ENCRYPTION_KEY`. Never share logs, screenshots, or shell history containing it:
   ```powershell
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64') + '\n')"
   ```
   Do not silently replace an existing key. Losing the key makes stored credentials unusable; there is no recovery without the separately backed-up key.
4. Start the backend and frontend per [../README.md](../README.md).
5. Open Super admin → Manage Aurvin. Save model/settings first to create revision 1, then use Replace key (credential replacement requires an existing document).
6. Validate and save each credential, then inspect `/api/operations/ready` and the dashboard configured state.

## 2. Existing setup import (operator-only)

1. Back up the application database and the private environment/master key through private channels.
2. Gracefully stop the backend and prove no in-flight executor or work remains (operations shutdown evidence, no sentinel deletion).
3. Build the backend (`npm run build` in `backend/`).
4. Run the explicit command from `backend/` (never automatically; never during install/startup):
   ```powershell
   node --enable-source-maps dist/scripts/import-config.js
   ```
   The command takes no arguments and reads no values from the command line. Record only the exit code, the printed category, and the imported setting count/names. Values are never printed.
5. Exit codes: `0` confirmed import with confirmed safe close; `2` already-configured no-op or ownership refusal; `1` invalid, unavailable, uncertain, cancelled, or unsafe close.
6. Restart the backend. Verify the stored revision, the dashboard configured state, and readiness. Only after success, remove the migrated manageable names manually from the private env file. Retain infrastructure settings and the master key. Never let tooling rewrite `.env`.

## 3. Credential validation limits

Validation uses `GET https://openrouter.ai/api/v1/key` with bearer authorization and Deepgram's documented `GET /v1/auth/token` with token authorization (region-selected US/EU hosts only, no redirects, no credential-bearing redirects). Bounds: 10-second request deadline, at most 64 KiB of response, no automatic retries. Malformed responses, timeouts, rate limits, and provider outages do not count as success. The model catalogue lookup is metadata, not inference. Recognition proves a credential is recognized, not paid-model access, speech-model support, account credit, correct billing rates, or voice/device quality. No paid endpoint is invoked by validation, import, or readiness.

## 4. Diagnostics without secret output

- Startup logs a name-only warning for ignored obsolete manageable environment settings (names, never values).
- Missing store: liveness works, the admin page reports storage unavailable, chat is not ready. No local substitute is written.
- Blank keys: usable configuration page with diagnostic/not-ready chat, not a bootstrap dependency on chat readiness.
- Storage outage: liveness stays available; no local substitute or plaintext fallback.
- Corrupt schema, wrong/missing master key, tampered envelopes, catalogue failure: actionable diagnostic failures. Corrupted data is never overwritten and plaintext environment keys are never used as fallback.
- Unknown write outcome: freeze conflicting changes and follow the mutation journal/reconciliation procedure. Never delete the sentinel, never blind-retry, never bypass the journal/quarantine.

## 5. Transport boundary

Outside explicit localhost development, browser-to-gateway traffic must use trusted HTTPS and gateway-to-backend traffic stays on the existing same-host loopback boundary. The development exception is plaintext localhost HTTP; do not label it encrypted. The gateway must terminate TLS and overwrite forwarding state with exactly this line in its TLS `/api/` location (it must not pass client-supplied forwarding values):

```nginx
proxy_set_header X-Forwarded-Proto https;
```

The existing deployment/staging configuration does not yet set that header; change it explicitly during gateway work, not here. Same-host processes remain trusted: a local process can forge headers, so origin/TLS checks are not authentication. Admin API responses use `Cache-Control: no-store`. Test simulated ingress locally only.

## 6. Backup and restore

Back up the encrypted configuration with the application database, and the master key separately under restricted access. To restore: provision an isolated release with a verified compatible schema, restore both database and key with no overlapping writer, match schema and master key, then verify safe configured metadata, decryption, and readiness using bounded operator actions. Never print or export credentials, and never use a restore as a silent configuration reset.

## 7. Lost key, tamper, or schema incidents

Preserve the encrypted data. Restore the correct separate key or a known backup under controlled stopped-work maintenance. Do not generate a replacement master key over existing ciphertext. Key rotation and secret-manager integration are out of scope. Replacement or removal through the UI applies to new work only; revoked keys can still break already-active requests, and cancellation cannot guarantee charge prevention.

## 8. Rollback limitations

A compatible config-aware release can read a supported schema; an environment-only older release ignores the encrypted config and cannot decrypt it into `.env`. Returning to one is an explicit stopped-work operator migration using originally retained private credentials/settings and a compatible database backup. There is no plaintext export endpoint and no promise that later revisions stay reversible. Local recovery binding and ownership restrictions stay intact.

## 9. Graceful stop, import interrupt, and test prerequisites

Graceful stop drains admitted text/voice/transport work and tracked configuration mutations within the fixed shutdown budget before releasing executor ownership. An interrupted import keeps evidence and a nonzero status; inspect and reconcile rather than rerunning as a reset. Native isolated-database checks (owned by P7) require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` with generated isolated databases only; never application data. Agent subprocess native checks stub private environment loading and use synthetic credential/provider fixtures.

## Evidence (unrun / assigned to P7)

No import execution, live validation, provisioning, deployment, gateway, Azure, or paid checks have been performed in this workflow and none are authorized here. Record actual native import/restart/security integration evidence, browser inspection results, and skipped prerequisites in verification, not by editing this runbook's procedures.

## P7 evidence update

- Browser dashboard fixture: 10/10 passed at desktop 1440x900 and mobile 390x844. Screenshots (untracked) under `.openchamber/screenshots/desktop-fix-2026-10-13T14-25-42-220.jpg` and `mobile-fix-2026-10-13T14-25-49-874.jpg`.
- Offline package checks: backend build/lint pass; backend unit 875 passed / 10 skipped; frontend build/lint pass; frontend tests 317 passed.
- Backend e2e: 19 passed / 37 skipped / 70 failed due to missing isolated replica-set prerequisites (`AURVIN_TEST_MONGODB_URI`, `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`). These are environment guards, not silent passes.
- Fixture import/restart was not run against any application database.
