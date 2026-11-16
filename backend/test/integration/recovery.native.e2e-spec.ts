/**
 * ============================================================================
 * FILE: recovery.native.e2e-spec.ts
 * LOCATION: backend/test/integration/recovery.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC12 saved-result recovery, no-result interrupt, and repeated reconcile.
 *
 * ROLE IN PROJECT:
 *    P10 in-process assembled recovery evidence. This is not OPS-06 process-kill.
 *
 * KEY COMPONENTS:
 *    - faultAssistantAppend: Crash after inference, before archive write.
 *    - handoffVerifiedStopped: Rejects oldProcessStopped false as NOT_READY.
 * ============================================================================
 */

import { AppService } from '../../src/app.service.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { createPersistenceBundle } from '../../src/persistence/index.js';
import { handoffVerifiedStopped } from '../../src/operations/index.js';
import { COLLECTIONS, openAssembled, submit, USER } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC12 recovers a saved result without a second completion POST', async () => {
  const h = await openAssembled({ faultAssistantAppend: true });
  try {
    // The assembled deployment carries the Calendar composition and the plugin
    // is neither configured nor connected. Ordinary text recovery must not
    // depend on a Calendar connection.
    expect(h.service.calendarConnections.isConfigured()).toBe(false);
    const accepted = await submit(h.agent, 'Recover me', 'p10-recover-request-1');
    const streamed = await h.agent.get(`/api${accepted.streamPath}`);
    expect(streamed.status !== 200 || !streamed.text.includes('"type":"completed"')).toBe(true);
    await h.service.operations.runtime.reconcileSession(USER, accepted.sessionId);
    await h.service.operations.runtime.reconcileSession(USER, accepted.sessionId);
    const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(status.body.status).toBe('completed');
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'assistant' })).toBe(1);
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC12 interrupts a no-result turn and retries once', async () => {
  const h = await openAssembled();
  try {
    const accepted = await submit(h.agent, 'No stream yet', 'p10-recover-request-2');
    await h.service.operations.runtime.reconcileSession(USER, accepted.sessionId);
    await h.service.operations.runtime.reconcileSession(USER, accepted.sessionId);
    const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(status.body.status).toBe('interrupted');
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'assistant' })).toBe(0);
    const retried = await h.agent.post(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}/retry`)
      .send({ idempotencyKey: 'p10-recover-request-3' }).expect(202);
    expect(retried.body.attemptId).not.toBe(accepted.attemptId);
    const streamed = await h.agent.get(`/api${retried.body.streamPath}`).expect(200);
    expect(streamed.text).toContain('"type":"completed"');
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC12 refuses a second executor and unverified handoff', async () => {
  const h = await openAssembled();
  try {
    await expect(AppService.create(loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
      MONGODB_DB_NAME: h.db.name, AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }), {
      writeLog: () => undefined,
      open: (config) => createPersistenceBundle(h.db.client, h.db.name, config.budgets),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    await expect(handoffVerifiedStopped(h.bundle.owner, h.service.operations.runtime, 'previous-owner', {
      oldProcessStopped: false, inFlightIoSettled: true, operatorAuthorized: true,
    })).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await h.close(); }
}, 60000);
