/**
 * ============================================================================
 * FILE: config-drain.spec.ts
 * LOCATION: backend/test/assembly/config-drain.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify config mutations drain before executor ownership is released.
 *
 * ROLE IN PROJECT:
 *    Covers in-flight save shutdown, uncertain-write quarantine, and
 *    concurrent shutdown identity without live providers or real databases.
 *
 * KEY COMPONENTS:
 *    - In-flight write: no close or late publication across shutdown.
 *    - Uncertain write: unsafe shutdown that retains ownership evidence.
 * ============================================================================
 */

import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { AppService } from '../../src/app.service.js';
import type { ConfigCasResult } from '../../src/contracts/config-runtime.js';
import { actor, document } from '../admin-config/fixtures.js';
import { assemblyFixture, deferred } from './admin-config-fixture.js';

describe('assembly config drain', () => {
  it('does not close or publish across an in-flight config write', async () => {
    const f = assemblyFixture(document(1));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const before = service.currentConfig.current();
      const pending = deferred<ConfigCasResult>();
      const started = deferred<void>();
      vi.mocked(f.repository.compareAndSwap).mockImplementationOnce(async () => {
        started.resolve();
        return pending.promise;
      });
      const saved = service.adminConfig.saveSettings({ protocolVersion: 1,
        expectedRevision: 1, settings: defaultManageableSettings() }, actor);
      const rejected = expect(saved).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
      await started.promise;
      const closing = service.operations.shutdown();
      expect(f.close).not.toHaveBeenCalled();
      pending.resolve({ outcome: 'confirmed', document: document(2) });
      await rejected;
      expect(service.currentConfig.current()).toBe(before);
      expect(await closing).toEqual({ safe: true });
      expect(f.close).toHaveBeenCalledTimes(1);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('keeps ownership evidence and reports unsafe on an uncertain write', async () => {
    const f = assemblyFixture(document(1));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const before = service.currentConfig.current();
      const pending = deferred<ConfigCasResult>();
      const started = deferred<void>();
      vi.mocked(f.repository.compareAndSwap).mockImplementationOnce(async () => {
        started.resolve();
        return pending.promise;
      });
      const saved = service.adminConfig.saveSettings({ protocolVersion: 1,
        expectedRevision: 1, settings: defaultManageableSettings() }, actor);
      const rejected = expect(saved).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
      await started.promise;
      const closing = service.operations.shutdown();
      expect(f.close).not.toHaveBeenCalled();
      pending.resolve({ outcome: 'uncertain' });
      await rejected;
      expect(service.currentConfig.current()).toBe(before);
      expect(await closing).toEqual({ safe: false });
      expect(f.close).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('fails validation in flight without publishing when shutdown wins the race', async () => {
    const f = assemblyFixture(document(1));
    const validation = deferred<Response>();
    const validating = vi.fn(async (url: unknown) => {
      if (String(url) === 'https://openrouter.ai/api/v1/key') return validation.promise;
      throw new Error('Unhandled fixture URL');
    });
    const service = await AppService.create(f.bootstrap, { ...f.ports, fetcher: validating });
    try {
      const before = service.currentConfig.current();
      const updated = service.adminConfig.updateCredential('openrouter', {
        protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-new-key',
      }, actor);
      const rejected = expect(updated).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
      await vi.waitFor(() => expect(validating).toHaveBeenCalledTimes(1));
      const closing = service.operations.shutdown();
      validation.resolve(Response.json({
        data: { label: 'discard', limit: null, usage: 0, is_free_tier: false },
      }));
      await rejected;
      expect(service.currentConfig.current()).toBe(before);
      expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
      expect(await closing).toEqual({ safe: true });
    } finally {
      await service.operations.shutdown();
    }
  });

  it('refuses new admission while admitted config work drains exactly once', async () => {
    const f = assemblyFixture(document(1));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const first = service.operations.shutdown();
      const second = service.operations.shutdown();
      expect(second).toBe(first);
      expect(await first).toEqual({ safe: true });
      expect(await second).toEqual({ safe: true });
      expect(f.close).toHaveBeenCalledTimes(1);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('reports unsafe without closing when runtime drain fails', async () => {
    const f = assemblyFixture(document(1));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      vi.mocked(f.raw.drain).mockResolvedValueOnce({ drained: false, active: 1, unresolvedWrites: 0 });
      expect(await service.operations.shutdown()).toEqual({ safe: false });
      expect(f.close).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });
});
