/**
 * ============================================================================
 * FILE: admin-config.service.ts
 * LOCATION: backend/src/admin-config/admin-config.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Read redacted admin configuration and persist confirmed whole-document CAS.
 *
 * ROLE IN PROJECT:
 *    Sequences prepare, durable revision writes, and publication so new work
 *    sees only confirmed snapshots. Credentials stay write-only and scoped.
 *
 * KEY COMPONENTS:
 *    - read: Public projection from stored metadata; never decrypts.
 *    - saveSettings / updateCredential: Independent mutation scopes and queues.
 * ============================================================================
 */

import type { z } from 'zod';
import {
  credentialUpdateRequestSchema,
  saveSettingsRequestSchema,
  type StoredConfigDocument,
} from '../contracts/admin-config.js';
import {
  ADMIN_CONFIG_FIELD_PATHS,
  type AdminConfigError,
  type CredentialProvider,
  type PublicAdminConfig,
} from '../contracts/admin-config-wire.js';
import type {
  AdminConfigActor,
  ConfigActivationPort,
  ConfigRepository,
  CurrentConfigPort,
  SnapshotCandidate,
} from '../contracts/config-runtime.js';
import { boundedResult } from '../operations/bounded.js';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import {
  defaultManageableSettings,
  projectPublicAdminConfig,
  validateManageableSettings,
} from '../platform/config/manageable-config.js';
import type { CredentialService } from './credential-service.js';
import { AuthFault } from '../auth/errors.js';
import { AdminConfigFault } from './errors.js';

export type AdminConfigOptions = {
  bootstrap: BootstrapConfig;
  repository: ConfigRepository;
  credentials: CredentialService;
  activation: ConfigActivationPort;
  current: CurrentConfigPort;
  assertWritable: () => Promise<void>;
  now?: () => number;
};

const MUTATION_LIMIT = 8;
const MUTATION_WAIT_MS = 30_000;
const PREPARE_MS = 10_000;
const VALIDATION_CONCURRENCY = 2;
const VALIDATION_WINDOW = 6;
const VALIDATION_WINDOW_MS = 60_000;
const FIELD_PATHS = new Set<string>(ADMIN_CONFIG_FIELD_PATHS);
type FieldError = AdminConfigError['error']['fieldErrors'][number];

export class AdminConfigService {
  private blocked = false;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];
  private validationInFlight = 0;
  private validationStarts: number[] = [];
  private readonly bootstrap: BootstrapConfig;
  private readonly repository: ConfigRepository;
  private readonly credentials: CredentialService;
  private readonly activation: ConfigActivationPort;
  private readonly current: CurrentConfigPort;
  private readonly assertWritable: () => Promise<void>;
  private readonly now: () => number;

  constructor(options: AdminConfigOptions) {
    this.bootstrap = options.bootstrap;
    this.repository = options.repository;
    this.credentials = options.credentials;
    this.activation = options.activation;
    this.current = options.current;
    this.assertWritable = options.assertWritable;
    this.now = options.now ?? Date.now;
  }

  async read(actor: AdminConfigActor): Promise<PublicAdminConfig> {
    this.assertActor(actor);
    const document = await this.readStored();
    return this.project(document);
  }

  async saveSettings(raw: unknown, actor: AdminConfigActor): Promise<PublicAdminConfig> {
    this.assertActor(actor);
    const request = this.parseSaveSettings(raw);
    const settings = this.settingsOrFault(request.settings);
    return this.mutate(async (expired, markDispatched) => {
      this.assertNotBlocked();
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const stored = await this.readStored();
      this.assertExpected(request.expectedRevision, stored);
      const candidate = this.buildDocument(
        request.expectedRevision + 1,
        settings,
        stored?.credentials ?? { openrouter: null, deepgram: null },
        actor,
      );
      const decrypted = this.credentials.decrypt(candidate);
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const snapshot = await this.prepare({
        revision: candidate.revision,
        settings: candidate.settings,
        credentials: decrypted,
      });
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      markDispatched();
      const result = stored === null
        ? await this.repository.createIfAbsent(candidate)
        : await this.repository.compareAndSwap(request.expectedRevision, candidate);
      return this.afterWrite(result, snapshot, expired);
    });
  }

  async updateCredential(
    provider: CredentialProvider,
    raw: unknown,
    actor: AdminConfigActor,
  ): Promise<PublicAdminConfig> {
    this.assertActor(actor);
    if (provider !== 'openrouter' && provider !== 'deepgram') {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
    const request = this.parseCredentialUpdate(raw);
    if (request.action === 'remove') {
      return this.removeCredential(provider, request.expectedRevision, actor);
    }
    this.assertNotBlocked();
    if (this.bootstrap.encryption.status !== 'ready') {
      throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
    }
    await this.writable();
    const stored = await this.readStored();
    // A missing store passes only with expectedRevision 0 (assertExpected); the
    // first key on a fresh database then starts from the defaults shown at revision 0.
    this.assertExpected(request.expectedRevision, stored);
    const region = (stored?.settings ?? defaultManageableSettings()).deepgram.region;
    this.acquireValidation(this.now());
    try {
      await this.credentials.validate(provider, request.candidate, region);
    } catch (error) {
      throw this.normalize(error);
    } finally {
      this.releaseValidation();
    }
    const candidate = request.candidate;
    return this.mutate(async (expired, markDispatched) => {
      this.assertNotBlocked();
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const latest = await this.readStored();
      this.assertExpected(request.expectedRevision, latest);
      const base = latest ?? { settings: defaultManageableSettings(), credentials: { openrouter: null, deepgram: null } };
      const envelope = this.credentials.seal(provider, candidate);
      const credentials = {
        openrouter: base.credentials.openrouter,
        deepgram: base.credentials.deepgram,
        [provider]: { envelope, validatedAt: new Date(this.now()).toISOString() },
      };
      const document = this.buildDocument(
        request.expectedRevision + 1,
        base.settings,
        credentials,
        actor,
      );
      const decrypted = this.credentials.decrypt(document);
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const snapshot = await this.prepare({
        revision: document.revision,
        settings: document.settings,
        credentials: decrypted,
      });
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      markDispatched();
      const result = latest === null
        ? await this.repository.createIfAbsent(document)
        : await this.repository.compareAndSwap(request.expectedRevision, document);
      return this.afterWrite(result, snapshot, expired);
    });
  }

  private async readStored(): Promise<StoredConfigDocument | null> {
    try {
      return await this.repository.read();
    } catch (error) {
      throw this.normalize(error);
    }
  }

  private project(document: StoredConfigDocument | null): PublicAdminConfig {
    const active = this.current.current();
    const activeRevision = active !== null && active.revision > 0 ? active.revision : null;
    return projectPublicAdminConfig(
      document,
      activeRevision === null ? null : active,
      this.activationState(document, activeRevision),
    );
  }

  private activationState(
    document: StoredConfigDocument | null,
    activeRevision: number | null,
  ): PublicAdminConfig['activation'] {
    if (this.blocked) return 'blocked';
    if (document === null) return 'unconfigured';
    if (activeRevision === null || activeRevision !== document.revision) return 'blocked';
    const chatReady = document.credentials.openrouter !== null
      && document.settings.openRouter.modelId !== '';
    return chatReady ? 'active' : 'unconfigured';
  }

  private async removeCredential(
    provider: CredentialProvider,
    expectedRevision: number,
    actor: AdminConfigActor,
  ): Promise<PublicAdminConfig> {
    return this.mutate(async (expired, markDispatched) => {
      this.assertNotBlocked();
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const stored = await this.readStored();
      if (expectedRevision === 0 && stored === null) return this.project(null);
      this.assertExpected(expectedRevision, stored);
      if (stored === null) throw new AdminConfigFault('CONFIG_CONFLICT', 0);
      const credentials = {
        openrouter: stored.credentials.openrouter,
        deepgram: stored.credentials.deepgram,
        [provider]: null,
      };
      const document = this.buildDocument(
        expectedRevision + 1,
        stored.settings,
        credentials,
        actor,
      );
      const decrypted = this.credentials.decrypt(document);
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      const snapshot = await this.prepare({
        revision: document.revision,
        settings: document.settings,
        credentials: decrypted,
      });
      await this.writable();
      if (expired()) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
      markDispatched();
      const result = await this.repository.compareAndSwap(expectedRevision, document);
      return this.afterWrite(result, snapshot, expired);
    });
  }

  private parseCredentialUpdate(raw: unknown) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      && Object.keys(raw).some((key) => key === 'updatedBy' || key === 'actor' || key === 'envelope')) {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
    const parsed = credentialUpdateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const unrecognized = parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
      const fieldErrors = mapFieldErrors(parsed.error);
      throw new AdminConfigFault(
        unrecognized || fieldErrors.length === 0 ? 'INVALID_CONFIG_REQUEST' : 'CONFIG_VALIDATION_FAILED',
        null,
        fieldErrors,
      );
    }
    return parsed.data;
  }

  private acquireValidation(now: number): void {
    this.validationStarts = this.validationStarts.filter((started) => now - started < VALIDATION_WINDOW_MS);
    if (this.validationStarts.length >= VALIDATION_WINDOW || this.validationInFlight >= VALIDATION_CONCURRENCY) {
      throw new AdminConfigFault('ADMIN_RATE_LIMITED');
    }
    this.validationStarts.push(now);
    this.validationInFlight++;
  }

  private releaseValidation(): void {
    if (this.validationInFlight > 0) this.validationInFlight--;
  }

  private parseSaveSettings(raw: unknown) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      && Object.keys(raw).some((key) => key === 'updatedBy' || key === 'actor' || key === 'envelope')) {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
    const parsed = saveSettingsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const unrecognized = parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
      const fieldErrors = mapFieldErrors(parsed.error);
      throw new AdminConfigFault(
        unrecognized || fieldErrors.length === 0 ? 'INVALID_CONFIG_REQUEST' : 'CONFIG_VALIDATION_FAILED',
        null,
        fieldErrors,
      );
    }
    return parsed.data;
  }

  private settingsOrFault(raw: unknown) {
    try {
      return validateManageableSettings(raw, this.bootstrap);
    } catch {
      throw new AdminConfigFault('CONFIG_VALIDATION_FAILED');
    }
  }

  private assertActor(actor: AdminConfigActor): void {
    if (actor.identity.source !== 'authenticated-session' ||
        actor.assumption.role !== 'super-admin' ||
        actor.assumption.authentication !== 'session' || actor.assumption.source !== 'local-account')
      throw new AuthFault('FORBIDDEN');
  }

  private assertExpected(expected: number, stored: StoredConfigDocument | null): void {
    if (expected === 0) {
      if (stored !== null) throw new AdminConfigFault('CONFIG_CONFLICT', stored.revision);
      return;
    }
    if (stored === null || stored.revision !== expected) {
      throw new AdminConfigFault('CONFIG_CONFLICT', stored?.revision ?? 0);
    }
  }

  private assertNotBlocked(): void {
    if (this.blocked) throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN');
  }

  private buildDocument(
    revision: number,
    settings: StoredConfigDocument['settings'],
    credentials: StoredConfigDocument['credentials'],
    actor: AdminConfigActor,
  ): StoredConfigDocument {
    return {
      _id: 'aurvin',
      schemaVersion: 1,
      revision,
      settings,
      credentials,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: actor.identity.userId,
    };
  }

  private async prepare(candidate: SnapshotCandidate) {
    let settled: { ok: true; value: Awaited<ReturnType<ConfigActivationPort['prepare']>> }
      | { ok: false; error: unknown } | undefined;
    const job = this.activation.prepare(candidate).then(
      (value) => { settled = { ok: true, value }; return value; },
      (error: unknown) => { settled = { ok: false, error }; throw error; },
    );
    await boundedResult(job, PREPARE_MS);
    if (settled?.ok) return settled.value;
    throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
  }

  private async afterWrite(
    result: Awaited<ReturnType<ConfigRepository['compareAndSwap']>>,
    snapshot: Awaited<ReturnType<ConfigActivationPort['prepare']>>,
    expired: () => boolean,
  ): Promise<PublicAdminConfig> {
    if (result.outcome === 'uncertain') {
      this.blocked = true;
      throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN');
    }
    if (result.outcome === 'conflict') {
      throw new AdminConfigFault('CONFIG_CONFLICT', result.currentRevision);
    }
    if (!this.sameDocument(result.document, snapshot.revision)) {
      this.blocked = true;
      throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN', result.document.revision);
    }
    if (expired() || this.blocked) {
      this.blocked = true;
      throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN', result.document.revision);
    }
    try {
      await this.writable();
      this.activation.publish(snapshot);
    } catch (error) {
      this.blocked = true;
      if (error instanceof AdminConfigFault && error.code === 'CONFIG_WRITE_UNCERTAIN') throw error;
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE', result.document.revision);
    }
    return this.project(result.document);
  }

  private sameDocument(document: StoredConfigDocument, revision: number): boolean {
    return document._id === 'aurvin' && document.schemaVersion === 1 && document.revision === revision;
  }

  private async writable(): Promise<void> {
    try {
      await this.assertWritable();
    } catch (error) {
      throw this.normalize(error, 'CONFIG_STORAGE_UNAVAILABLE');
    }
  }

  private async mutate<T>(
    action: (expired: () => boolean, markDispatched: () => void) => Promise<T>,
  ): Promise<T> {
    if (this.inFlight + this.waiters.length >= MUTATION_LIMIT) {
      throw new AdminConfigFault('ADMIN_RATE_LIMITED');
    }
    let expired = false;
    let dispatched = false;
    const run = async () => {
      this.inFlight++;
      try {
        if (expired) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
        return await action(() => expired, () => { dispatched = true; });
      } finally {
        this.inFlight--;
        this.waiters.shift()?.();
      }
    };
    const started = this.inFlight > 0
      ? new Promise<void>((resolve) => this.waiters.push(resolve)).then(run)
      : run();
    let settled: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
    const tracked = started.then(
      (value) => { settled = { ok: true, value }; return value; },
      (error: unknown) => { settled = { ok: false, error }; throw error; },
    );
    await boundedResult(tracked, MUTATION_WAIT_MS);
    if (settled?.ok) return settled.value;
    if (settled && !settled.ok) throw this.normalize(settled.error);
    expired = true;
    if (dispatched) {
      this.blocked = true;
      throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN');
    }
    throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
  }

  private normalize(error: unknown, fallback: AdminConfigFault['code'] = 'CONFIG_STORAGE_UNAVAILABLE'): AdminConfigFault {
    if (error instanceof AdminConfigFault) return error;
    return new AdminConfigFault(fallback);
  }
}

function mapFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    if (out.length >= 20) break;
    const path = issue.path
      .filter((part): part is string => typeof part === 'string' && part !== 'settings')
      .join('.');
    if (!FIELD_PATHS.has(path)) continue;
    let code: FieldError['code'] = 'invalid';
    if (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined') {
      code = 'required';
    } else if (issue.code === 'too_small' || issue.code === 'too_big') {
      code = 'out_of_range';
    } else if (issue.code === 'custom') {
      code = 'cross_field';
    } else if (issue.code === 'unrecognized_keys') {
      code = 'unsupported';
    } else if (issue.code === 'invalid_literal') {
      code = 'immutable';
    }
    out.push({ path, code });
  }
  return out;
}
