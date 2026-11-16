/**
 * ============================================================================
 * FILE: admin-config.service.spec.ts
 * LOCATION: backend/src/admin-config/admin-config.service.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify redacted admin errors, settings saves, and credential mutations.
 *
 * ROLE IN PROJECT:
 *    Protects the independently composable admin configuration service so
 *    secrets, raw exceptions, and unconfirmed writes never reach the wire.
 *
 * KEY COMPONENTS:
 *    - Safe-fault tests: Closed error bodies without cause, stack, or secrets.
 *    - Mutation tests: Independent settings/credential CAS and publication.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { isAdminConfigError } from '../contracts/admin-config-wire.js';
import { defaultManageableSettings } from '../platform/config/manageable-config.js';
import { actor, at, document, secret, serviceFixture } from '../../test/admin-config/fixtures.js';
import { AdminConfigFault, adminConfigFaultFromUnknown } from './errors.js';

describe('admin config faults', () => {
  it('exposes a safe fault body without arbitrary message, cause, or stack', () => {
    const fault = new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    expect(fault.body()).toEqual({
      protocolVersion: 1,
      error: {
        code: 'CONFIG_STORAGE_UNAVAILABLE',
        retryable: true,
        currentRevision: null,
        fieldErrors: [],
      },
    });
    const json = JSON.stringify(fault);
    expect(json).not.toMatch(/cause/i);
    expect(fault.body()).not.toHaveProperty('message');
    expect(fault.body()).not.toHaveProperty('stack');
    expect(fault.body().error).not.toHaveProperty('message');
    expect(fault.stack).toBeDefined();
    expect(JSON.stringify(fault.body())).not.toContain(fault.stack);
  });

  it('allowlists field paths and truncates to twenty errors', () => {
    const secret = 'sk-live-secret-never-leak';
    const extra = Array.from({ length: 25 }, (_, index) => ({
      path: index < 22 ? 'chat.titleMaxChars' : 'secret.candidate',
      code: index === 21 ? 'hacked' : 'invalid',
      message: secret,
    }));
    const fault = new AdminConfigFault(
      'CONFIG_VALIDATION_FAILED',
      4,
      extra as never,
    );
    const body = fault.body();
    expect(isAdminConfigError(body)).toBe(true);
    expect(body.error.fieldErrors).toHaveLength(20);
    expect(body.error.fieldErrors.every((item) =>
      item.path === 'chat.titleMaxChars' && item.code === 'invalid')).toBe(true);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('hacked');
    expect(JSON.stringify(body)).not.toContain('secret.candidate');
    expect(body.error.retryable).toBe(false);
    expect(body.error.currentRevision).toBe(4);
    expect(fault.status).toBe(422);
  });

  it('never copies thrown secrets into a static unknown fault', () => {
    const secret = 'sk-live-secret-never-leak';
    const thrown = new Error(secret, { cause: { candidate: secret, envelope: secret } });
    const fault = adminConfigFaultFromUnknown();
    expect(fault.code).toBe('CONFIG_STORAGE_UNAVAILABLE');
    expect(fault.retryable).toBe(true);
    expect(JSON.stringify(fault.body())).not.toContain(secret);
    expect(fault.cause).toBeUndefined();
    expect(thrown.message).toBe(secret);
  });

  it('marks only allowlisted codes retryable', () => {
    expect(new AdminConfigFault('CONFIG_WRITE_UNCERTAIN').retryable).toBe(false);
    expect(new AdminConfigFault('CONFIG_CONFLICT').retryable).toBe(false);
    expect(new AdminConfigFault('CONFIG_STORED_INVALID').retryable).toBe(false);
    expect(new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE').retryable).toBe(false);
    expect(new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE').retryable).toBe(false);
    expect(new AdminConfigFault('ADMIN_RATE_LIMITED').retryable).toBe(true);
    expect(new AdminConfigFault('ADMIN_RATE_LIMITED').status).toBe(429);
    expect(new AdminConfigFault('INVALID_CONFIG_REQUEST').status).toBe(400);
    expect(new AdminConfigFault('CREDENTIAL_VALIDATION_TIMEOUT').status).toBe(504);
    expect(new AdminConfigFault('CREDENTIAL_PROVIDER_UNAVAILABLE').status).toBe(502);
  });
});

describe('admin config service', () => {
  it('saves only settings then publishes confirmed persistence', async () => {
    const f = serviceFixture();
    const settings = defaultManageableSettings(); settings.chat.titleMaxChars = 70;
    const result = await f.service.saveSettings({ protocolVersion: 1, expectedRevision: 1, settings }, actor);
    expect(result.revision).toBe(2);
    expect(f.stored()?.credentials).toEqual({ openrouter: null, deepgram: null });
    expect(f.activation.publish).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('updatedBy');
    expect(result).not.toHaveProperty('envelope');
  });

  it('creates revision 1 from a missing store and reads defaults safely', async () => {
    const f = serviceFixture(null);
    const missing = await f.service.read(actor);
    expect(missing).toMatchObject({ revision: 0, state: 'missing', activation: 'unconfigured' });
    const result = await f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings(),
    }, actor);
    expect(result.revision).toBe(1);
    expect(result.state).toBe('stored');
    expect(f.repository.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(f.activation.publish).toHaveBeenCalledTimes(1);
  });

  it('redacts existing credential envelopes on read', async () => {
    const seeded = document();
    const f = serviceFixture();
    const envelope = f.credentials.seal('openrouter', secret);
    seeded.credentials.openrouter = { envelope, validatedAt: at };
    const stored = serviceFixture(seeded);
    const result = await stored.service.read(actor);
    expect(result.credentials.openrouter).toEqual({ configured: true, validatedAt: at });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(envelope.ciphertext);
    expect(result).not.toHaveProperty('updatedBy');
  });

  it('returns static faults for stored schema and storage failures', async () => {
    const invalid = serviceFixture();
    vi.mocked(invalid.repository.read).mockRejectedValueOnce(
      new AdminConfigFault('CONFIG_STORED_INVALID'),
    );
    await expect(invalid.service.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    const unavailable = serviceFixture();
    vi.mocked(unavailable.repository.read).mockRejectedValueOnce(new Error('mongo down'));
    await expect(unavailable.service.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
  });

  it('rejects unknown fields, stale revisions, and storage-cap settings', async () => {
    const f = serviceFixture();
    const settings = defaultManageableSettings();
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings, extra: true,
    }, actor)).rejects.toMatchObject({ code: 'INVALID_CONFIG_REQUEST' });
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 0, settings,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', currentRevision: 1 });
    settings.chat.maxInputTokens = 70_000;
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_VALIDATION_FAILED' });
    expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
    expect(f.stored()?.revision).toBe(1);
  });

  it('stamps the trusted actor and keeps prepare before CAS before publish', async () => {
    const f = serviceFixture();
    const settings = defaultManageableSettings();
    settings.chat.titleMaxChars = 71;
    await f.service.saveSettings({ protocolVersion: 1, expectedRevision: 1, settings }, actor);
    expect(f.activation.prepare.mock.invocationCallOrder[0]!)
      .toBeLessThan(f.repository.compareAndSwap.mock.invocationCallOrder[0]!);
    expect(f.repository.compareAndSwap.mock.invocationCallOrder[0]!)
      .toBeLessThan(f.activation.publish.mock.invocationCallOrder[0]!);
    expect(f.stored()?.updatedBy).toBe(actor.identity.userId);
    expect(f.stored()?.updatedAt).toBe(at);
    expect(f.repository.compareAndSwap.mock.calls[0]?.[1]?.updatedBy).toBe(actor.identity.userId);
  });

  it('does not write when prepare fails', async () => {
    const f = serviceFixture();
    f.activation.prepare.mockRejectedValueOnce(new Error('catalogue'));
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
    expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
    expect(f.activation.publish).not.toHaveBeenCalled();
  });

  it('rejects a ninth queued mutation', async () => {
    const f = serviceFixture();
    const settings = defaultManageableSettings();
    const gate = Promise.withResolvers<{ outcome: 'confirmed'; document: ReturnType<typeof document> }>();
    vi.mocked(f.repository.compareAndSwap).mockImplementation(() => gate.promise);
    const body = { protocolVersion: 1 as const, expectedRevision: 1, settings };
    const started = Array.from({ length: 8 }, () => f.service.saveSettings(body, actor));
    await vi.waitFor(() => expect(f.repository.compareAndSwap).toHaveBeenCalled());
    await expect(f.service.saveSettings(body, actor)).rejects.toMatchObject({ code: 'ADMIN_RATE_LIMITED' });
    gate.resolve({ outcome: 'confirmed', document: { ...document(2), settings } });
    await Promise.allSettled(started);
  });

  it('validates and saves a key in one scoped operation', async () => {
    const f = serviceFixture();
    const result = await f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor);
    expect(result.revision).toBe(2);
    expect(result.credentials.openrouter).toEqual({ configured: true, validatedAt: at });
    expect(f.stored()?.settings).toEqual(document().settings);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(f.credentials.decrypt(f.stored()!).openrouter).toBe(secret);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('saves the first key on a fresh database by creating revision 1 from defaults', async () => {
    const f = serviceFixture(null);
    const result = await f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 0, action: 'replace', candidate: secret,
    }, actor);
    expect(result).toMatchObject({ revision: 1, state: 'stored' });
    expect(result.credentials.openrouter).toEqual({ configured: true, validatedAt: at });
    expect(f.repository.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
    expect(f.stored()?.settings).toEqual(defaultManageableSettings());
    expect(f.stored()?.credentials.deepgram).toBeNull();
    expect(f.credentials.decrypt(f.stored()!).openrouter).toBe(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    // A stale non-zero revision against a missing store is still a conflict.
    const stale = serviceFixture(null);
    await expect(stale.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', currentRevision: 0 });
    expect(stale.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a key validated against an older revision', async () => {
    const f = serviceFixture();
    const gate = Promise.withResolvers<Response>();
    f.fetchImpl.mockImplementationOnce(() => gate.promise);
    const replacing = f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor);
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
    const settings = defaultManageableSettings(); settings.chat.titleMaxChars = 65;
    await f.service.saveSettings({ protocolVersion: 1, expectedRevision: 1, settings }, actor);
    gate.resolve(Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: true } }));
    await expect(replacing).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', currentRevision: 2 });
    expect(f.stored()?.settings.chat.titleMaxChars).toBe(65);
    expect(f.stored()?.credentials.openrouter).toBeNull();
    expect(f.activation.publish).toHaveBeenCalledTimes(1);
  });

  it('preserves the previous envelope when the candidate is rejected', async () => {
    const seeded = document();
    const helper = serviceFixture();
    const envelope = helper.credentials.seal('openrouter', secret);
    seeded.credentials.openrouter = { envelope, validatedAt: at };
    const f = serviceFixture(seeded);
    f.fetchImpl.mockResolvedValueOnce(new Response('revoked', { status: 401 }));
    await expect(f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'new-key',
    }, actor)).rejects.toMatchObject({ code: 'CREDENTIAL_REJECTED' });
    expect(f.stored()?.credentials.openrouter?.envelope).toEqual(envelope);
    expect(f.activation.publish).not.toHaveBeenCalled();
    expect(JSON.stringify(f.stored())).not.toContain('new-key');
  });

  it.each([
    [429, 'CREDENTIAL_PROVIDER_RATE_LIMITED'],
    [503, 'CREDENTIAL_PROVIDER_UNAVAILABLE'],
    [200, 'CREDENTIAL_PROVIDER_RESPONSE_INVALID'],
  ] as const)('preserves the old key for provider status %s', async (status, code) => {
    const seeded = document();
    const helper = serviceFixture();
    const envelope = helper.credentials.seal('deepgram', secret);
    seeded.credentials.deepgram = { envelope, validatedAt: at };
    const f = serviceFixture(seeded);
    f.fetchImpl.mockResolvedValueOnce(new Response(status === 200 ? '{}' : 'nope', { status }));
    await expect(f.service.updateCredential('deepgram', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'new-key',
    }, actor)).rejects.toMatchObject({ code });
    expect(f.stored()?.credentials.deepgram?.envelope).toEqual(envelope);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('validates Deepgram using the persisted US and EU regions', async () => {
    const us = serviceFixture();
    await us.service.updateCredential('deepgram', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor);
    expect(us.fetchImpl).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/auth/token',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Token ${secret}` }) }),
    );
    const euDoc = document();
    euDoc.settings.deepgram.region = 'eu';
    const eu = serviceFixture(euDoc);
    await eu.service.updateCredential('deepgram', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor);
    expect(eu.fetchImpl).toHaveBeenCalledWith(
      'https://api.eu.deepgram.com/v1/auth/token',
      expect.anything(),
    );
    expect(eu.stored()?.credentials.openrouter).toBeNull();
  });

  it('leaves the other provider unchanged when replacing one key', async () => {
    const seeded = document();
    const helper = serviceFixture();
    const deepgram = helper.credentials.seal('deepgram', secret);
    seeded.credentials.deepgram = { envelope: deepgram, validatedAt: at };
    const f = serviceFixture(seeded);
    await f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor);
    expect(f.stored()?.credentials.deepgram?.envelope).toEqual(deepgram);
    expect(f.credentials.decrypt(f.stored()!).openrouter).toBe(secret);
  });

  it('refuses a third concurrent validation and a seventh start in one minute', async () => {
    const f = serviceFixture();
    const gate = Promise.withResolvers<Response>();
    f.fetchImpl.mockImplementation(() => gate.promise);
    const body = { protocolVersion: 1 as const, expectedRevision: 1, action: 'replace' as const, candidate: secret };
    const first = f.service.updateCredential('openrouter', body, actor);
    const second = f.service.updateCredential('openrouter', body, actor);
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(2));
    await expect(f.service.updateCredential('openrouter', body, actor))
      .rejects.toMatchObject({ code: 'ADMIN_RATE_LIMITED' });
    gate.resolve(Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: true } }));
    await Promise.allSettled([first, second]);

    let now = Date.parse(at);
    const timed = serviceFixture(document(), () => now);
    timed.fetchImpl.mockResolvedValue(new Response('nope', { status: 401 }));
    const replace = { protocolVersion: 1 as const, expectedRevision: 1, action: 'replace' as const, candidate: secret };
    for (let i = 0; i < 6; i++) {
      await expect(timed.service.updateCredential('openrouter', replace, actor))
        .rejects.toMatchObject({ code: 'CREDENTIAL_REJECTED' });
    }
    await expect(timed.service.updateCredential('openrouter', replace, actor))
      .rejects.toMatchObject({ code: 'ADMIN_RATE_LIMITED' });
    expect(timed.fetchImpl).toHaveBeenCalledTimes(6);
    await timed.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor);
    await expect(timed.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 2, action: 'replace', candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'ADMIN_RATE_LIMITED' });
    now += 60_000;
    await expect(timed.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 2, action: 'replace', candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'CREDENTIAL_REJECTED' });
  });

  it('refuses stale revisions and missing master keys before fetch', async () => {
    const f = serviceFixture();
    await expect(f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 0, action: 'replace', candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
    expect(f.fetchImpl).not.toHaveBeenCalled();

    const { loadBootstrapConfig } = await import('../platform/config/bootstrap-config.js');
    const { CredentialService } = await import('./credential-service.js');
    const { CredentialValidator } = await import('./credential-validation.js');
    const { AdminConfigService } = await import('./admin-config.service.js');
    const missing = loadBootstrapConfig({ NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173' });
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
    const service = new AdminConfigService({
      bootstrap: missing,
      repository: f.repository,
      credentials: new CredentialService(missing.encryption, new CredentialValidator(fetchImpl)),
      activation: f.activation,
      current: { current: () => null },
      assertWritable: f.assertWritable,
      now: () => Date.parse(at),
    });
    await expect(service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_ENCRYPTION_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('performs confirmed removal of one credential', async () => {
    const seeded = document();
    const helper = serviceFixture();
    const openrouter = helper.credentials.seal('openrouter', secret);
    const deepgram = helper.credentials.seal('deepgram', secret);
    seeded.credentials = {
      openrouter: { envelope: openrouter, validatedAt: at },
      deepgram: { envelope: deepgram, validatedAt: at },
    };
    const f = serviceFixture(seeded);
    const result = await f.service.updateCredential('deepgram', {
      protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
    }, actor);
    expect(result.revision).toBe(2);
    expect(result.credentials.deepgram).toEqual({ configured: false, validatedAt: null });
    expect(f.stored()?.credentials.deepgram).toBeNull();
    expect(f.stored()?.credentials.openrouter?.envelope).toEqual(openrouter);
    expect(f.stored()?.settings).toEqual(document().settings);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.activation.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects unconfirmed removal without writing', async () => {
    const f = serviceFixture();
    await expect(f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: false,
    }, actor)).rejects.toMatchObject({ code: 'INVALID_CONFIG_REQUEST' });
    await expect(f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true, candidate: secret,
    }, actor)).rejects.toMatchObject({ code: 'INVALID_CONFIG_REQUEST' });
    await expect(f.service.updateCredential('unknown' as never, {
      protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
    }, actor)).rejects.toMatchObject({ code: 'INVALID_CONFIG_REQUEST' });
    expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
  });

  it('never publishes an uncertain write', async () => {
    const f = serviceFixture();
    vi.mocked(f.repository.compareAndSwap).mockResolvedValueOnce({ outcome: 'uncertain' });
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
    expect(f.activation.publish).not.toHaveBeenCalled();
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
    expect(f.repository.compareAndSwap).toHaveBeenCalledTimes(1);
    expect((await f.service.read(actor)).activation).toBe('blocked');
  });

  it('latches blocked when publish throws after a confirmed write', async () => {
    const f = serviceFixture();
    f.activation.publish.mockImplementationOnce(() => {
      throw new Error('pointer update');
    });
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
    expect(f.repository.compareAndSwap).toHaveBeenCalledTimes(1);
    expect((await f.service.read(actor)).activation).toBe('blocked');
  });

  it('latches blocked when ownership fails after confirmed CAS', async () => {
    const f = serviceFixture();
    f.assertWritable
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('journal'));
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
    expect((await f.service.read(actor)).activation).toBe('blocked');
  });

  it('does not confirm a mismatched repository document', async () => {
    const f = serviceFixture();
    vi.mocked(f.repository.compareAndSwap).mockResolvedValueOnce({
      outcome: 'confirmed', document: document(9),
    });
    await expect(f.service.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings(),
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
    expect(f.activation.publish).not.toHaveBeenCalled();
  });

  it('returns the missing projection for expected-0 removal', async () => {
    const f = serviceFixture(null);
    const result = await f.service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 0, action: 'remove', confirm: true,
    }, actor);
    expect(result).toMatchObject({ revision: 0, state: 'missing' });
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
  });

  it('cannot remove a key when a remaining envelope cannot be decrypted', async () => {
    const seeded = document();
    const helper = serviceFixture();
    seeded.credentials.openrouter = {
      envelope: helper.credentials.seal('openrouter', secret),
      validatedAt: at,
    };
    seeded.credentials.deepgram = {
      envelope: helper.credentials.seal('deepgram', secret),
      validatedAt: at,
    };
    const { loadBootstrapConfig } = await import('../platform/config/bootstrap-config.js');
    const { CredentialService } = await import('./credential-service.js');
    const { CredentialValidator } = await import('./credential-validation.js');
    const { AdminConfigService } = await import('./admin-config.service.js');
    const missing = loadBootstrapConfig({ NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173' });
    const f = serviceFixture(seeded);
    const service = new AdminConfigService({
      bootstrap: missing,
      repository: f.repository,
      credentials: new CredentialService(missing.encryption, new CredentialValidator(f.fetchImpl)),
      activation: f.activation,
      current: { current: () => null },
      assertWritable: f.assertWritable,
      now: () => Date.parse(at),
    });
    await expect(service.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
    }, actor)).rejects.toMatchObject({ code: 'CONFIG_ENCRYPTION_UNAVAILABLE' });
    expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
  });
});
