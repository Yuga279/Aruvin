import { expect, it } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { actor, document } from './fixtures.js';
import { assemblyFixture, deferred } from '../assembly/admin-config-fixture.js';

it('delayed validation conflicts with newer settings', async () => {
  const f = assemblyFixture(document(1));
  const started = deferred<void>();
  const response = deferred<Response>();
  f.fetcher.mockImplementationOnce(async () => {
    started.resolve();
    return response.promise;
  });
  const app = await AppService.create(f.bootstrap, f.ports);
  try {
    const replacement = app.adminConfig.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1,
      action: 'replace', candidate: 'fixture-only-new-key',
    }, actor);
    const rejected = expect(replacement).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
    await started.promise;
    const settings = structuredClone(document(1).settings);
    settings.chat.titleMaxChars = 70;
    const saved = await app.adminConfig.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings,
    }, actor);
    response.resolve(Response.json({ data: {
      label: 'discard', limit: null, usage: 0, is_free_tier: false,
    } }));
    await rejected;
    expect(saved.revision).toBe(2);
    expect(app.currentConfig.current()?.revision).toBe(2);
    expect(f.stored()?.settings.chat.titleMaxChars).toBe(70);
    expect(f.stored()?.credentials.openrouter).toBeNull();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.repository.compareAndSwap).toHaveBeenCalledOnce();
  } finally {
    response.resolve(Response.json({}));
    await app.operations.shutdown();
  }
});