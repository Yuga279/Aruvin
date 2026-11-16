/**
 * ============================================================================
 * FILE: connection.ts
 * LOCATION: backend/src/plugins/google-calendar/connection.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Connection lifecycle, OAuth grant installation, and credential management.
 *
 * ROLE IN PROJECT:
 *    Manages Google Calendar v2 account connections, token rotation with single-flight
 *    coalescing, preference rebase, and capability gating for multi-calendar operations.
 *
 * KEY COMPONENTS:
 *    - GoogleCalendarConnections: Central connection and credential management service
 *    - installGrant: Fenced v2 grant installation preserving user defaults
 *    - withAccessToken: Single-flight credential rotation with preference rebase
 *    - settings / disconnect: Account preference updates and local/remote revocation
 * ============================================================================
 */

import { randomBytes } from 'node:crypto';
import type { DiagnosticSink } from '../../chat-runtime/ports.js';
import { z } from 'zod';
import {
  connectionRecordSchema,
  type CalendarAccountCredentialPort,
  type CalendarConnectionBinding,
  type CalendarConnectionGate,
  type CalendarCredentialPort,
  type CalendarConnectionRecord,
  type CalendarConnectionStore,
  type CalendarTargetPort,
} from '../../contracts/calendar-connections.js';
import {
  CALENDAR_LIMITS,
  CALENDAR_PROOF_REVISION,
  CALENDAR_SCOPES,
  calendarGrantStatus,
} from '../../contracts/calendar-policy.js';
import { idSchema } from '../../contracts/identifiers.js';
import {
  calendarAccountBindingSchema,
  calendarConnectionV2Schema,
  calendarResolvedTargetSchema,
  effectiveCalendarCapabilities,
  type CalendarAccountBinding,
  type CalendarConnectionRecordV2,
  type CalendarConnectionStoreV2,
  type CalendarDiscoveryEntry,
  type CalendarDiscoveryPort,
  type CalendarResolvedTarget,
} from '../../contracts/calendar-discovery.js';
import type { CalendarCapabilityGate } from '../../contracts/calendar-authority.js';
import {
  calendarDisconnectRequestSchema,
  calendarDisconnectResponseSchema,
  calendarRefreshRequestSchema,
  calendarCalendarsQuerySchema,
  calendarCalendarsResponseSchema,
  calendarSettingsRequestSchema,
  calendarSettingsV2RequestSchema,
  calendarStatusV2ResponseSchema,
  type CalendarPublicStatus,
} from '../../contracts/calendar-wire.js';

export type CalendarCalendarsResponse = z.infer<typeof calendarCalendarsResponseSchema>;
export type CalendarStatusV2Response = z.infer<typeof calendarStatusV2ResponseSchema>;
import { AppError } from '../../platform/errors/app-error.js';
import { CalendarSecretCipher } from '../../platform/crypto/calendar-secret-cipher.js';
import { CalendarDiscoveryService } from './discovery.js';
import { publicStatus, publicStatusV2, type CalendarSetupOptions } from './options.js';
import type { OAuthGrant } from './oauth-client.js';
import { toolFault } from './tools-validation.js';

export type ConnectionOAuthClient = {
  refresh(input: {
    refreshToken: string; signal: AbortSignal; deadlineAt: string;
  }): Promise<{
    accessToken: string; refreshToken: string | null;
    expiresAt: string; scopes: string[] | null;
  }>;
  revoke(input: {
    token: string; signal: AbortSignal; deadlineAt: string;
  }): Promise<'confirmed' | 'failed' | 'unknown'>;
};

export type ConnectionDependencies = {
  store: CalendarConnectionStore; cipher: CalendarSecretCipher;
  options: CalendarSetupOptions; userId: string;
  client: ConnectionOAuthClient; target?: CalendarTargetPort;
  now?: () => number;
  onInvalidated?: (binding: CalendarConnectionBinding,
    reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required') => Promise<void>;
  storeV2?: CalendarConnectionStoreV2;
  discovery?: CalendarDiscoveryPort;
  retentionPolicy?: () => { policyId: string; expiresAt: string } | null;
  onAccountInvalidated?: (account: CalendarAccountBinding,
    reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required') => Promise<void>;
  diagnostic?: DiagnosticSink;
};

function encryptionReady(cipher: CalendarSecretCipher): boolean {
  try {
    cipher.sealVerifier({
      userId: 'u',
      stateHash: 'a'.repeat(64),
      browserHash: 'b'.repeat(64),
      oidcNonceHash: 'c'.repeat(64),
      redirectUri: 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    }, 'A'.repeat(43));
    return true;
  } catch {
    return false;
  }
}

export type SetupSnapshot = Readonly<{
  userId: string;
  recordRevision: number | null;
  lifecycleEpoch: number;
  redirectUri: string;
  expectedGoogleSubjectId: string | null;
  connectionId: string | null;
}>;

export type InstallGrantInput = {
  snapshot: SetupSnapshot; grant: OAuthGrant;
  account: { subject: string; email: string | null };
  signal: AbortSignal; deadlineAt: string; isCurrentFlow: () => boolean;
};

const PROOF_REVISION = 'google-calendar.events-owned.v1';

export function tokenAad(record: Pick<CalendarConnectionRecord,
  'userId' | 'connectionId' | 'credentialVersion' | 'googleSubjectId'>,
  tokenKind: 'access' | 'refresh') {
  return { version: 1 as const, provider: 'google-calendar' as const,
    userId: record.userId, connectionId: record.connectionId,
    credentialVersion: record.credentialVersion, googleSubjectId: record.googleSubjectId, tokenKind };
}

const ACCESS_MARGIN_MS = 30_000;

export class GoogleCalendarConnections implements CalendarConnectionGate, CalendarCredentialPort, CalendarAccountCredentialPort {
  readonly userId: string;
  readonly credentials: CalendarAccountCredentialPort = this;
  readonly discoveryService: CalendarDiscoveryService | null;
  readonly capabilityGate: CalendarCapabilityGate;
  private readonly store: CalendarConnectionStore;
  private readonly storeV2?: CalendarConnectionStoreV2;
  private readonly cipher: CalendarSecretCipher;
  private readonly options: CalendarSetupOptions;
  private readonly client: ConnectionOAuthClient;
  private readonly target?: CalendarTargetPort;
  private readonly discoveryPort?: CalendarDiscoveryPort;
  private readonly retentionPolicy?: () => { policyId: string; expiresAt: string } | null;
  private readonly clock: () => number;
  private readonly onInvalidated?: ConnectionDependencies['onInvalidated'];
  private readonly onAccountInvalidated?: ConnectionDependencies['onAccountInvalidated'];
  private readonly hasEncryption: boolean;
  private pendingEnabled: boolean | null = null;
  private hardFenced = false;
  private executionFenced = false;
  private closing = false;
  private lifecycleEpoch = 0;
  private partialGrantDiagnostic: { lifecycleEpoch: number; missingScopes: readonly string[] } | null = null;
  private refreshFlight: { key: string; promise: Promise<void> } | null = null;
  private refreshFlightV2: { key: string; promise: Promise<void>; controller: AbortController } | null = null;
  private mutating = false;
  private closingController = new AbortController();

  constructor(dependencies: ConnectionDependencies) {
    this.userId = idSchema.parse(dependencies.userId);
    this.store = dependencies.store;
    this.storeV2 = dependencies.storeV2;
    this.cipher = dependencies.cipher;
    this.options = dependencies.options;
    this.client = dependencies.client;
    this.target = dependencies.target;
    this.discoveryPort = dependencies.discovery;
    this.retentionPolicy = dependencies.retentionPolicy;
    this.clock = dependencies.now ?? Date.now;
    this.onInvalidated = dependencies.onInvalidated;
    this.onAccountInvalidated = dependencies.onAccountInvalidated;
    this.hasEncryption = encryptionReady(dependencies.cipher);
    this.discoveryService = dependencies.storeV2 && dependencies.discovery
      ? new CalendarDiscoveryService({
          store: dependencies.storeV2,
          provider: dependencies.discovery,
          credentials: this,
          requireAccountCurrent: (account, signal) => this.requireAccountCurrent(account, signal),
          refreshAfterUnauthorized: (input) => this.refreshAfterUnauthorized(input),
          rejectUnauthorizedAccount: (account) => this.rejectUnauthorizedAccount(account),
          retentionPolicy: dependencies.retentionPolicy ?? (() => ({
            policyId: dependencies.options.initial.processingPolicyId ?? 'fixture-policy',
            expiresAt: new Date((dependencies.now ?? Date.now)() + CALENDAR_LIMITS.discoveryFreshnessMs).toISOString(),
          })),
          limits: dependencies.options.initial.limits ?? CALENDAR_LIMITS,
          now: dependencies.now ?? Date.now,
          diagnostic: dependencies.diagnostic,
        })
      : null;
    this.capabilityGate = {
      resolve: (input) => this.resolveTarget(input),
      requireCurrent: (input) => this.requireTargetCurrent(input),
    };
  }

  getLifecycleEpoch(): number {
    return this.lifecycleEpoch;
  }

  invalidateLifecycle(): void {
    this.lifecycleEpoch += 1;
  }
  cancelPendingWork(): void {
    this.invalidateLifecycle();
    this.refreshFlightV2?.controller.abort();
  }

  recordPartialGrantDiagnostic(lifecycleEpoch: number, missingScopes: readonly string[]): void {
    if (lifecycleEpoch >= this.lifecycleEpoch) {
      this.partialGrantDiagnostic = { lifecycleEpoch, missingScopes };
    }
  }

  clearPartialGrantDiagnostic(): void {
    this.partialGrantDiagnostic = null;
  }

  isConfigured(): boolean {
    const policyOk = this.retentionPolicy
      ? (() => {
          const p = this.retentionPolicy();
          return p !== null && Date.parse(p.expiresAt) > this.clock();
        })()
      : this.options.initial.processingPolicyId !== null;
    return this.options.oauth !== null
      && this.hasEncryption
      && this.options.realDataPolicyApproved
      && policyOk;
  }

  async status(): Promise<CalendarPublicStatus> {
    const record = this.storeV2 ? await this.storeV2.get(this.userId) : await this.store.get(this.userId);
    const enabled = record?.enabled ?? this.pendingEnabled ?? this.options.initial.enabled;
    const configured = this.isConfigured();
    const degraded = this.hardFenced || this.executionFenced || this.closing;
    return publicStatus({ enabled, configured, degraded, record, options: this.options });
  }

  async statusV2(): Promise<CalendarStatusV2Response> {
    const record = this.storeV2 ? await this.storeV2.get(this.userId) : await this.store.get(this.userId);
    const enabled = record?.enabled ?? this.pendingEnabled ?? this.options.initial.enabled;
    const configured = this.isConfigured();
    const degraded = this.hardFenced || this.executionFenced || this.closing;
    return publicStatusV2({
      enabled,
      configured,
      degraded,
      record,
      options: this.options,
      now: this.clock(),
      partialGrantDiagnostic: this.partialGrantDiagnostic,
      lifecycleEpoch: this.lifecycleEpoch,
    });
  }

  async beginConsent(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new AppError('CANCELLED', 'Calendar setup was cancelled.', false);
    if (this.closing || this.hardFenced) throw new AppError('NOT_READY', 'Calendar setup is required.', false);
    this.lifecycleEpoch += 1;
    if (!this.storeV2) return;
    const current = await this.storeV2.get(this.userId);
    if (!current || current.schemaVersion !== 2 || current.status !== 'connected') {
      return;
    }
    const next = calendarConnectionV2Schema.parse({
      ...current,
      revision: current.revision + 1,
      connectionRevision: current.connectionRevision + 1,
      status: 'reconnect-required',
      discovery: null,
      updatedAt: new Date(this.clock()).toISOString(),
    });
    const cas = await this.storeV2.compareAndSwap({
      userId: this.userId,
      expectedRevision: current.revision,
      expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next,
    });
    if (cas.outcome !== 'confirmed') {
      this.hardFenced = true;
      throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.', false);
    }
    if (this.onAccountInvalidated) {
      await this.onAccountInvalidated(
        {
          userId: current.userId,
          connectionId: current.connectionId,
          connectionRevision: current.connectionRevision,
          googleSubjectId: current.googleSubjectId,
        },
        'reconnect-required',
      );
    }
  }

  async captureSetupSnapshot(): Promise<SetupSnapshot> {
    if (this.closing || this.hardFenced || this.mutating || this.options.oauth === null || !this.isConfigured()) {
      throw new AppError('NOT_READY', 'Calendar setup is required.', false);
    }
    const record = this.storeV2 ? await this.storeV2.get(this.userId) : await this.store.get(this.userId);
    if (record?.schemaVersion === 1) {
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    const hasAccount = record && record.status !== 'disconnected';
    return {
      userId: this.userId,
      recordRevision: record?.revision ?? null,
      lifecycleEpoch: this.lifecycleEpoch,
      redirectUri: this.options.oauth.redirectUri,
      expectedGoogleSubjectId: hasAccount ? record.googleSubjectId : null,
      connectionId: hasAccount ? record.connectionId : null,
    };
  }

  isCurrentSnapshot(snapshot: SetupSnapshot): boolean {
    return snapshot.userId === this.userId
      && snapshot.lifecycleEpoch === this.lifecycleEpoch
      && this.options.oauth !== null
      && snapshot.redirectUri === this.options.oauth.redirectUri
      && !this.hardFenced
      && !this.closing;
  }

  async currentAccount(): Promise<CalendarAccountBinding> {
    const record = this.storeV2 ? await this.storeV2.get(this.userId) : await this.store.get(this.userId);
    if (!record || record.schemaVersion !== 2 || record.status === 'disconnected') {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    if (!record.enabled || this.hardFenced || this.executionFenced || this.closing) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (!this.isConfigured()) {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    const grantStatus = calendarGrantStatus(record.grantedScopes);
    if (grantStatus.state !== 'complete' || record.status !== 'connected') {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    return calendarAccountBindingSchema.parse({
      userId: record.userId,
      connectionId: record.connectionId,
      connectionRevision: record.connectionRevision,
      googleSubjectId: record.googleSubjectId,
    });
  }

  async requireAccountCurrent(account: CalendarAccountBinding, signal: AbortSignal): Promise<CalendarConnectionRecordV2> {
    if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (this.hardFenced || this.executionFenced || this.closing) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (!this.isConfigured() || !this.storeV2) {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    const record = await this.storeV2.get(this.userId);
    if (!record || record.schemaVersion !== 2) {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    if (record.userId !== account.userId
      || record.connectionId !== account.connectionId
      || record.connectionRevision !== account.connectionRevision
      || record.googleSubjectId !== account.googleSubjectId) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (!record.enabled || record.status !== 'connected') {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (calendarGrantStatus(record.grantedScopes).state !== 'complete') {
      throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    }
    return record;
  }

  async installGrant(input: InstallGrantInput): Promise<void> {
    if (input.signal.aborted || this.closing || this.hardFenced || !input.isCurrentFlow()
      || !this.isCurrentSnapshot(input.snapshot)) {
      this.hardFenced = true;
      throw toolFault('policy', 'CALENDAR_SETUP_STALE');
    }
    if (calendarGrantStatus(input.grant.scopes).state !== 'complete') {
      throw toolFault('credential', 'OAUTH_SCOPE_REJECTED');
    }
    if (input.snapshot.expectedGoogleSubjectId !== null
      && input.snapshot.expectedGoogleSubjectId !== input.account.subject) {
      throw toolFault('credential', 'OAUTH_SUBJECT_CHANGED');
    }
    const current = this.storeV2 ? await this.storeV2.get(this.userId) : await this.store.get(this.userId);
    if (current && current.schemaVersion === 1) {
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    const currentV2 = current && current.schemaVersion === 2 ? current : null;
    if ((currentV2?.revision ?? null) !== input.snapshot.recordRevision) {
      throw toolFault('policy', 'CALENDAR_SETUP_STALE');
    }
    if (currentV2 && currentV2.status === 'connected' && currentV2.connectionId === input.snapshot.connectionId) {
      throw toolFault('policy', 'CALENDAR_SETUP_STALE');
    }
    const replacing = currentV2 !== null && (currentV2.status === 'disconnected'
      || currentV2.googleSubjectId !== input.account.subject);
    const connectionId = !currentV2 || replacing ? randomBytes(16).toString('hex') : currentV2.connectionId;
    const credentialVersion = currentV2 ? currentV2.credentialVersion + 1 : 1;
    const aad = {
      userId: this.userId,
      connectionId,
      credentialVersion,
      googleSubjectId: input.account.subject,
    };
    const defaultSetting = currentV2 && !replacing
      ? currentV2.defaultSetting
      : {
          defaultCalendarId: null,
          defaultSettingRevision: currentV2 ? currentV2.defaultSetting.defaultSettingRevision + 1 : 1,
        };
    const now = new Date(this.clock()).toISOString();
    const next = calendarConnectionV2Schema.parse({
      schemaVersion: 2,
      userId: this.userId,
      provider: 'google-calendar',
      connectionId,
      revision: currentV2 ? currentV2.revision + 1 : 1,
      connectionRevision: currentV2 ? currentV2.connectionRevision + 1 : 1,
      credentialVersion,
      googleSubjectId: input.account.subject,
      accountEmail: input.account.email,
      enabled: true,
      status: 'connected',
      defaultSetting,
      discovery: null,
      credentials: {
        access: this.cipher.sealToken(tokenAad(aad, 'access'), input.grant.accessToken),
        refresh: this.cipher.sealToken(tokenAad(aad, 'refresh'), input.grant.refreshToken),
      },
      tokenExpiresAt: input.grant.expiresAt,
      grantedScopes: input.grant.scopes,
      updatedAt: now,
    });
    if (!this.storeV2) {
      throw new AppError('PERSISTENCE_ERROR', 'Store v2 is required.', false);
    }
    const cas = currentV2
      ? await this.storeV2.compareAndSwap({
          userId: this.userId,
          expectedRevision: currentV2.revision,
          expectedConnectionRevision: currentV2.connectionRevision,
          expectedDefaultSettingRevision: currentV2.defaultSetting.defaultSettingRevision,
          next,
        })
      : await this.storeV2.create(next);
    if (cas.outcome !== 'confirmed') {
      this.hardFenced = true;
      throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
    }
    if (!input.isCurrentFlow() || !this.isCurrentSnapshot(input.snapshot) || this.closing || this.hardFenced) {
      this.hardFenced = true;
      throw toolFault('policy', 'CALENDAR_SETUP_STALE');
    }
    this.executionFenced = false;
    this.clearPartialGrantDiagnostic();
    if (currentV2 && replacing) {
      if (this.onAccountInvalidated) {
        await this.onAccountInvalidated(
          {
            userId: currentV2.userId,
            connectionId: currentV2.connectionId,
            connectionRevision: currentV2.connectionRevision,
            googleSubjectId: currentV2.googleSubjectId,
          },
          'replacement',
        );
      }
      await this.onInvalidated?.(this.bindingOf(currentV2), 'replacement');
    }
    if (this.discoveryService) {
      try {
        const account = await this.currentAccount();
        await this.discoveryService.refresh({
          account,
          mode: 'out-of-turn',
          signal: input.signal,
          deadlineAt: input.deadlineAt,
          force: true,
          purpose: 'discovery',
          consumeRequest: async () => undefined,
          consumeRefreshRequest: async () => undefined,
        });
      } catch {
        /* A failed/partial post-connect scan leaves connected credentials plus absent/partial cache; do not roll back credentials */
      }
    }
  }

  async settings(request: unknown, signal: AbortSignal): Promise<CalendarPublicStatus> {
    const body = calendarSettingsV2RequestSchema.parse(request);
    this.assertDeadline(new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(), signal);
    this.admitMutation();
    try {
      if (body.enabled === false) {
        this.fence('disabled');
        this.pendingEnabled = false;
      } else if (body.enabled === true && !this.closing) {
        this.pendingEnabled = true;
      }
      if (this.storeV2) {
        const current = await this.storeV2.get(this.userId);
        if (current && current.schemaVersion === 2) {
          if (body.defaultSetting !== undefined) {
            if (
              body.defaultSetting.expectedRevision !== current.defaultSetting.defaultSettingRevision ||
              body.defaultSetting.expectedConnectionRevision !== current.connectionRevision
            ) {
              throw toolFault('policy', 'CALENDAR_SETTINGS_CONFLICT');
            }
            if (body.defaultSetting.calendarId !== null) {
              if (!current.enabled || current.status !== 'connected' || this.hardFenced || this.closing) {
                throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
              }
              const account: CalendarAccountBinding = {
                userId: current.userId,
                connectionId: current.connectionId,
                connectionRevision: current.connectionRevision,
                googleSubjectId: current.googleSubjectId,
              };
              const gateResult = await this.resolveTarget({
                account,
                selector: body.defaultSetting.calendarId,
                operation: 'create',
                signal,
                deadlineAt: new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(),
                consumeRequest: async () => undefined,
                consumeRefreshRequest: async () => undefined,
              });
              if (gateResult.outcome !== 'resolved' || gateResult.target.calendarId !== body.defaultSetting.calendarId) {
                throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
              }
            }
          }

          const latest = await this.storeV2.get(this.userId);
          if (!latest || latest.schemaVersion !== 2) {
            this.hardFenced = true;
            throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
          }
          if (body.defaultSetting !== undefined) {
            if (
              body.defaultSetting.expectedRevision !== latest.defaultSetting.defaultSettingRevision ||
              body.defaultSetting.expectedConnectionRevision !== latest.connectionRevision
            ) {
              throw toolFault('policy', 'CALENDAR_SETTINGS_CONFLICT');
            }
          }

          const enabled = body.enabled ?? latest.enabled;
          const defaultId = body.defaultSetting === undefined
            ? latest.defaultSetting.defaultCalendarId
            : body.defaultSetting.calendarId;
          const settingChanged = defaultId !== latest.defaultSetting.defaultCalendarId;
          const authorityChanged = enabled !== latest.enabled;

          if (!settingChanged && !authorityChanged) {
            if (body.enabled === true) {
              this.executionFenced = false;
            }
            return this.status();
          }

          let next = calendarConnectionV2Schema.parse({
            ...latest,
            revision: latest.revision + 1,
            enabled,
            connectionRevision: latest.connectionRevision + Number(authorityChanged),
            defaultSetting: {
              defaultCalendarId: defaultId,
              defaultSettingRevision: latest.defaultSetting.defaultSettingRevision + Number(settingChanged),
            },
            discovery: authorityChanged ? null : latest.discovery,
            updatedAt: new Date(this.clock()).toISOString(),
          });

          let cas = await this.storeV2.compareAndSwap({
            userId: this.userId,
            expectedRevision: latest.revision,
            expectedConnectionRevision: latest.connectionRevision,
            expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
            next,
          });

          if (cas.outcome === 'conflict') {
            const recheck = await this.storeV2.get(this.userId);
            if (
              recheck &&
              recheck.schemaVersion === 2 &&
              recheck.connectionId === latest.connectionId &&
              recheck.connectionRevision === latest.connectionRevision &&
              recheck.defaultSetting.defaultSettingRevision === latest.defaultSetting.defaultSettingRevision
            ) {
              next = calendarConnectionV2Schema.parse({
                ...recheck,
                revision: recheck.revision + 1,
                enabled,
                connectionRevision: recheck.connectionRevision + Number(authorityChanged),
                defaultSetting: {
                  defaultCalendarId: defaultId,
                  defaultSettingRevision: recheck.defaultSetting.defaultSettingRevision + Number(settingChanged),
                },
                discovery: authorityChanged ? null : recheck.discovery,
                updatedAt: new Date(this.clock()).toISOString(),
              });
              cas = await this.storeV2.compareAndSwap({
                userId: this.userId,
                expectedRevision: recheck.revision,
                expectedConnectionRevision: recheck.connectionRevision,
                expectedDefaultSettingRevision: recheck.defaultSetting.defaultSettingRevision,
                next,
              });
            }
          }

          if (cas.outcome === 'uncertain') {
            this.hardFenced = true;
            throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
          }
          if (cas.outcome !== 'confirmed') {
            throw toolFault('policy', 'CALENDAR_SETTINGS_CONFLICT');
          }

          if (authorityChanged && !enabled) {
            if (this.onAccountInvalidated) {
              await this.onAccountInvalidated(
                {
                  userId: latest.userId,
                  connectionId: latest.connectionId,
                  connectionRevision: latest.connectionRevision,
                  googleSubjectId: latest.googleSubjectId,
                },
                'disabled',
              );
            }
            await this.onInvalidated?.(this.bindingOf(latest), 'disabled');
          }
          if (body.enabled === true) {
            this.executionFenced = false;
          }
          return this.status();
        }
      }
      if (body.defaultSetting !== undefined) {
        throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
      }
      const record = await this.store.get(this.userId);
      if (!record) return this.status();
      if (body.enabled === undefined || record.enabled === body.enabled) return this.status();
      const next = connectionRecordSchema.parse({
        ...record,
        enabled: body.enabled,
        revision: record.revision + 1,
        connectionRevision: record.connectionRevision + 1,
        updatedAt: new Date(this.clock()).toISOString(),
      });
      const cas = await this.store.compareAndSwap(this.userId, record.revision, next);
      if (cas.outcome !== 'confirmed') {
        this.hardFenced = true;
        throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
      }
      if (!body.enabled) {
        await this.onInvalidated?.(this.bindingOf(record), 'disabled');
      }
      return this.status();
    } finally {
      this.mutating = false;
    }
  }

  async disconnect(request: unknown, signal: AbortSignal): Promise<{
    disconnected: true; remoteRevocation: 'not-requested' | 'confirmed' | 'failed' | 'unknown';
  }> {
    const body = calendarDisconnectRequestSchema.parse(request);
    this.assertDeadline(new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(), signal);
    this.admitMutation();
    this.fence('disconnect');
    try {
      if (this.storeV2) {
        const current = await this.storeV2.get(this.userId);
        if (!current || current.schemaVersion !== 2 || current.status === 'disconnected') {
          return calendarDisconnectResponseSchema.parse({
            disconnected: true, remoteRevocation: 'not-requested',
          });
        }
        let refreshToken: string | null = null;
        if (body.mode === 'revoke-google-grant' && current.credentials?.refresh) {
          try {
            refreshToken = this.cipher.openToken(tokenAad(current, 'refresh'), current.credentials.refresh);
          } catch {
            refreshToken = null;
          }
        }
        const credentialVersion = current.credentials ? current.credentialVersion + 1 : current.credentialVersion;
        const next = calendarConnectionV2Schema.parse({
          ...current,
          revision: current.revision + 1,
          connectionRevision: current.connectionRevision + 1,
          credentialVersion,
          enabled: false,
          status: 'disconnected',
          credentials: null,
          tokenExpiresAt: null,
          discovery: null,
          updatedAt: new Date(this.clock()).toISOString(),
        });
        const cas = await this.storeV2.compareAndSwap({
          userId: this.userId,
          expectedRevision: current.revision,
          expectedConnectionRevision: current.connectionRevision,
          expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
          next,
        });
        if (cas.outcome !== 'confirmed') {
          this.hardFenced = true;
          throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
        }
        if (this.onAccountInvalidated) {
          await this.onAccountInvalidated(
            {
              userId: current.userId,
              connectionId: current.connectionId,
              connectionRevision: current.connectionRevision,
              googleSubjectId: current.googleSubjectId,
            },
            'disconnect',
          );
        }
        await this.onInvalidated?.(this.bindingOf(current), 'disconnect');
        if (body.mode === 'local') {
          return calendarDisconnectResponseSchema.parse({
            disconnected: true, remoteRevocation: 'not-requested',
          });
        }
        if (refreshToken === null) {
          return calendarDisconnectResponseSchema.parse({
            disconnected: true, remoteRevocation: 'unknown',
          });
        }
        try {
          const remote = await this.client.revoke({
            token: refreshToken,
            signal,
            deadlineAt: new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(),
          });
          return calendarDisconnectResponseSchema.parse({
            disconnected: true, remoteRevocation: remote,
          });
        } finally {
          refreshToken = null;
        }
      }
      const current = await this.store.get(this.userId);
      if (!current || current.status === 'disconnected') {
        return calendarDisconnectResponseSchema.parse({
          disconnected: true, remoteRevocation: 'not-requested',
        });
      }
      let refreshToken: string | null = null;
      if (body.mode === 'revoke-google-grant' && current.credentials?.refresh) {
        try {
          refreshToken = this.cipher.openToken(tokenAad(current, 'refresh'), current.credentials.refresh);
        } catch {
          refreshToken = null;
        }
      }
      const cleared = await this.clearLocal(current);
      if (!cleared) {
        this.hardFenced = true;
        throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
      }
      await this.onInvalidated?.(this.bindingOf(current), 'disconnect');
      if (body.mode === 'local') {
        return calendarDisconnectResponseSchema.parse({
          disconnected: true, remoteRevocation: 'not-requested',
        });
      }
      if (refreshToken === null) {
        return calendarDisconnectResponseSchema.parse({
          disconnected: true, remoteRevocation: 'unknown',
        });
      }
      try {
        const remote = await this.client.revoke({
          token: refreshToken,
          signal,
          deadlineAt: new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(),
        });
        return calendarDisconnectResponseSchema.parse({
          disconnected: true, remoteRevocation: remote,
        });
      } finally {
        refreshToken = null;
      }
    } finally {
      this.mutating = false;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.hardFenced = true;
    this.lifecycleEpoch += 1;
    this.closingController.abort();
    this.refreshFlightV2?.controller.abort();
    this.refreshFlightV2 = null;
    this.refreshFlight = null;
    this.discoveryService?.invalidate();
  }

  async calendars(query: unknown): Promise<CalendarCalendarsResponse> {
    const { pageToken } = calendarCalendarsQuerySchema.parse(query ?? {});
    if (!this.storeV2) {
      throw new AppError('NOT_READY', 'Calendar setup is required.', false);
    }
    const record = await this.storeV2.get(this.userId);
    if (!record || record.schemaVersion !== 2 || record.status === 'disconnected' || !record.discovery) {
      throw new AppError('NOT_READY', 'Calendar discovery is required.', false);
    }
    const nowTimestamp = this.clock();
    if (nowTimestamp >= Date.parse(record.discovery.retentionExpiresAt)) {
      throw new AppError('NOT_READY', 'Calendar discovery has expired.', false);
    }
    if (!this.discoveryService) {
      throw new AppError('NOT_READY', 'Discovery service is not available.', false);
    }
    const account: CalendarAccountBinding = {
      userId: record.userId,
      connectionId: record.connectionId,
      connectionRevision: record.connectionRevision,
      googleSubjectId: record.googleSubjectId,
    };
    return this.discoveryService.page({
      account,
      discovery: record.discovery,
      pageToken,
    });
  }

  async refreshCalendars(request: unknown, signal: AbortSignal): Promise<CalendarCalendarsResponse> {
    const body = calendarRefreshRequestSchema.parse(request);
    this.assertDeadline(new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString(), signal);
    const account = await this.currentAccount();
    if (body.expectedConnectionRevision !== account.connectionRevision) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Connection revision mismatch.', false);
    }
    if (!this.discoveryService) {
      throw new AppError('NOT_READY', 'Discovery service is not available.', false);
    }
    const deadlineAt = new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString();
    const beforeRecord = await this.requireAccountCurrent(account, signal);
    const fresh = await this.discoveryService.refresh({
      account,
      mode: 'out-of-turn',
      signal,
      deadlineAt,
      force: true,
      purpose: 'discovery',
      consumeRequest: async () => undefined,
      consumeRefreshRequest: async () => undefined,
    });
    const afterRecord = await this.requireAccountCurrent(account, signal);
    if (beforeRecord.discovery?.complete && !fresh.complete) {
      throw toolFault('policy', 'CALENDAR_DISCOVERY_PARTIAL');
    }
    if (!fresh.complete && (!afterRecord.discovery || afterRecord.discovery.discoveryRevision !== fresh.discoveryRevision)) {
      throw toolFault('policy', 'CALENDAR_DISCOVERY_PARTIAL');
    }
    const currentDiscovery = afterRecord.discovery ?? fresh;
    return this.discoveryService.page({ account, discovery: currentDiscovery });
  }

  async resolveTarget(input: {
    account: CalendarAccountBinding;
    selector: string | null;
    operation: 'read' | 'create' | 'availability';
    signal: AbortSignal;
    deadlineAt: string;
    consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<
    | { outcome: 'resolved'; target: CalendarResolvedTarget }
    | {
        outcome: 'clarify';
        code:
          | 'CALENDAR_TARGET_AMBIGUOUS'
          | 'CALENDAR_TARGET_UNKNOWN'
          | 'CALENDAR_DEFAULT_UNAVAILABLE'
          | 'CALENDAR_PRIMARY_MISSING';
        candidates: CalendarResolvedTarget[];
      }
    | {
        outcome: 'denied';
        code:
          | 'CALENDAR_RECONNECT_REQUIRED'
          | 'CALENDAR_TARGET_READ_ONLY'
          | 'CALENDAR_EXECUTION_DENIED';
      }
  > {
    const account: CalendarAccountBinding = {
      userId: input.account.userId,
      connectionId: input.account.connectionId,
      connectionRevision: input.account.connectionRevision,
      googleSubjectId: input.account.googleSubjectId,
    };
    const record = await this.requireAccountCurrent(account, input.signal);
    if (!this.discoveryService) {
      return { outcome: 'denied', code: 'CALENDAR_EXECUTION_DENIED' };
    }
    const fresh = await this.discoveryService.ensureFresh({
      account,
      mode: 'in-turn',
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      force: false,
      purpose: 'capability-recheck',
      consumeRequest: input.consumeRequest,
      consumeRefreshRequest: input.consumeRefreshRequest,
    });

    let entry: CalendarDiscoveryEntry | undefined;
    let selectedBy: 'explicit' | 'saved-default' | 'primary';

    if (input.selector !== null) {
      if (input.selector === 'primary') {
        selectedBy = 'primary';
        entry = fresh.entries.find((e) => e.primary);
        if (!entry) {
          return { outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING', candidates: [] };
        }
      } else {
        selectedBy = 'explicit';
        const exactIdMatch = fresh.entries.find((e) => e.calendarId === input.selector);
        if (exactIdMatch) {
          entry = exactIdMatch;
        } else {
          const norm = (s: string) => s.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
          const targetNorm = norm(input.selector);
          const labelMatches = fresh.entries.filter((e) => norm(e.label) === targetNorm);
          if (labelMatches.length === 1) {
            entry = labelMatches[0];
          } else if (labelMatches.length > 1) {
            const candidates = labelMatches.slice(0, 20).map((cand) => {
              const candCaps = effectiveCalendarCapabilities(
                cand.accessRole,
                record.grantedScopes,
                this.isConfigured() && !cand.hidden && !cand.deleted,
              );
              return calendarResolvedTargetSchema.parse({
                ...account,
                calendarId: cand.calendarId,
                calendarLabel: cand.label,
                targetRevision: account.connectionRevision,
                discoveryRevision: fresh.discoveryRevision,
                selectedBy: 'explicit',
                accessRole: cand.accessRole,
                privateAccess: cand.privateAccess,
                capabilities: candCaps,
                verifiedAt: fresh.fetchedAt,
                proofRevision: CALENDAR_PROOF_REVISION,
              });
            });
            return { outcome: 'clarify', code: 'CALENDAR_TARGET_AMBIGUOUS', candidates };
          } else {
            return { outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN', candidates: [] };
          }
        }
      }
    } else {
      const defaultId = record.defaultSetting?.defaultCalendarId ?? null;
      if (defaultId !== null) {
        selectedBy = 'saved-default';
        entry = fresh.entries.find((e) => e.calendarId === defaultId);
        if (!entry) {
          return { outcome: 'clarify', code: 'CALENDAR_DEFAULT_UNAVAILABLE', candidates: [] };
        }
      } else {
        selectedBy = 'primary';
        entry = fresh.entries.find((e) => e.primary);
        if (!entry) {
          return { outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING', candidates: [] };
        }
      }
    }

    const caps = effectiveCalendarCapabilities(
      entry.accessRole,
      record.grantedScopes,
      this.isConfigured() && !entry.hidden && !entry.deleted,
    );
    const key =
      input.operation === 'read'
        ? 'readEvents'
        : input.operation === 'create'
          ? 'createEvents'
          : 'availability';
    if (!caps[key]) {
      return {
        outcome: 'denied',
        code: input.operation === 'create' ? 'CALENDAR_TARGET_READ_ONLY' : 'CALENDAR_EXECUTION_DENIED',
      };
    }

    const target = calendarResolvedTargetSchema.parse({
      ...account,
      calendarId: entry.calendarId,
      calendarLabel: entry.label,
      targetRevision: account.connectionRevision,
      discoveryRevision: fresh.discoveryRevision,
      selectedBy,
      accessRole: entry.accessRole,
      privateAccess: entry.privateAccess,
      capabilities: caps,
      verifiedAt: fresh.fetchedAt,
      proofRevision: CALENDAR_PROOF_REVISION,
    });
    return { outcome: 'resolved', target };
  }

  async requireTargetCurrent(input: {
    target: CalendarResolvedTarget;
    operation: 'read' | 'create' | 'availability';
    signal: AbortSignal;
    deadlineAt: string;
    consumeRequest: (kind: 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<void> {
    calendarResolvedTargetSchema.parse(input.target);
    const account: CalendarAccountBinding = {
      userId: input.target.userId,
      connectionId: input.target.connectionId,
      connectionRevision: input.target.connectionRevision,
      googleSubjectId: input.target.googleSubjectId,
    };
    const record = await this.requireAccountCurrent(account, input.signal);
    const epoch = this.getLifecycleEpoch();
    if (!this.discoveryService) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    const entry = await this.discoveryService.checkTarget({
      account,
      calendarId: input.target.calendarId,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      consumeRequest: async () => input.consumeRequest('capability-recheck'),
      consumeRefreshRequest: input.consumeRefreshRequest,
    });
    await this.requireAccountCurrent(account, input.signal);
    if (this.getLifecycleEpoch() !== epoch) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (!entry) {
      throw toolFault('policy', 'CALENDAR_TARGET_UNKNOWN');
    }
    const caps = effectiveCalendarCapabilities(
      entry.accessRole,
      record.grantedScopes,
      this.isConfigured() && !entry.hidden && !entry.deleted,
    );
    const key =
      input.operation === 'read'
        ? 'readEvents'
        : input.operation === 'create'
          ? 'createEvents'
          : 'availability';
    if (!caps[key]) {
      throw toolFault('policy', input.operation === 'create' ? 'CALENDAR_TARGET_READ_ONLY' : 'CALENDAR_EXECUTION_DENIED');
    }
  }

  async currentBinding(): Promise<CalendarConnectionBinding> {
    const record = await this.store.get(this.userId);
    const binding = this.bindingOf(this.requireUsable(record, new AbortController().signal));
    return Object.freeze({ ...binding });
  }

  async requireCurrent(binding: CalendarConnectionBinding, signal: AbortSignal): Promise<void> {
    this.assertBinding(binding, signal);
    const record = await this.store.get(this.userId);
    this.assertBinding(binding, signal);
    this.requireUsable(record, signal);
    this.assertBindingMatches(record!, binding);
  }

  async withAccessToken<T>(
    input: {
      account: CalendarAccountBinding;
      signal: AbortSignal;
      deadlineAt: string;
      consumeRefreshRequest: () => Promise<void>;
    },
    action: (accessToken: string) => Promise<T>,
  ): Promise<T>;
  async withAccessToken<T>(
    input: {
      binding: CalendarConnectionBinding;
      signal: AbortSignal;
      deadlineAt: string;
      consumeRefreshRequest: () => Promise<void>;
    },
    action: (accessToken: string) => Promise<T>,
  ): Promise<T>;
  async withAccessToken<T>(
    input:
      | { account: CalendarAccountBinding; signal: AbortSignal; deadlineAt: string; consumeRefreshRequest: () => Promise<void> }
      | { binding: CalendarConnectionBinding; signal: AbortSignal; deadlineAt: string; consumeRefreshRequest: () => Promise<void> },
    action: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    if ('binding' in input) {
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    const { account, signal, deadlineAt, consumeRefreshRequest } = input;
    let record = await this.requireAccountCurrent(account, signal);
    this.assertDeadline(deadlineAt, signal);
    if (this.needsRefresh(record)) {
      await this.refreshCurrentV2(record, account, signal, deadlineAt, consumeRefreshRequest);
      record = await this.requireAccountCurrent(account, signal);
    }
    let accessToken: string;
    try {
      accessToken = this.cipher.openToken(tokenAad(record, 'access'), record.credentials!.access!);
    } catch {
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    this.assertDeadline(deadlineAt, signal);
    return action(accessToken);
  }

  async refreshAfterUnauthorized(input: {
    account: CalendarAccountBinding;
    signal: AbortSignal;
    deadlineAt: string;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<void> {
    const record = await this.requireAccountCurrent(input.account, input.signal);
    await this.refreshCurrentV2(record, input.account, input.signal, input.deadlineAt, input.consumeRefreshRequest, true);
  }

  async rejectUnauthorizedAccount(account: CalendarAccountBinding): Promise<void> {
    const current = await this.storeV2?.get(this.userId);
    if (current && current.schemaVersion === 2 && current.connectionId === account.connectionId) {
      await this.markReconnectRequiredV2(current);
    }
  }

  private bindingOf(record: CalendarConnectionRecord | CalendarConnectionRecordV2): CalendarConnectionBinding {
    const calendarId = 'calendarId' in record
      ? record.calendarId
      : (record.defaultSetting?.defaultCalendarId ?? this.options.oauth?.targetCalendarId ?? 'primary');
    const targetRevision = 'targetRevision' in record ? record.targetRevision : 1;
    return {
      userId: record.userId,
      connectionId: record.connectionId,
      connectionRevision: record.connectionRevision,
      googleSubjectId: record.googleSubjectId,
      calendarId,
      targetRevision,
    };
  }

  private requireUsable(
    record: CalendarConnectionRecord | CalendarConnectionRecordV2 | null,
    signal: AbortSignal,
  ): CalendarConnectionRecord | CalendarConnectionRecordV2 {
    if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (this.hardFenced || this.executionFenced || this.closing) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    if (!record || record.userId !== this.userId || !record.enabled || record.status !== 'connected'
      || !record.credentials?.access || !record.credentials.refresh
      || !CALENDAR_SCOPES.every((scope) => record.grantedScopes.includes(scope))) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (this.options.oauth?.targetCalendarId) {
      const calId = 'calendarId' in record
        ? record.calendarId
        : (record.defaultSetting?.defaultCalendarId ?? this.options.oauth.targetCalendarId ?? 'primary');
      if (calId !== this.options.oauth.targetCalendarId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
    }
    return record;
  }

  private assertBinding(binding: CalendarConnectionBinding, signal: AbortSignal): void {
    if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (this.hardFenced || this.executionFenced || this.closing) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    if (binding.userId !== this.userId) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  }

  private assertBindingMatches(
    record: CalendarConnectionRecord | CalendarConnectionRecordV2,
    binding: CalendarConnectionBinding,
  ): void {
    const calendarId = 'calendarId' in record
      ? record.calendarId
      : (record.defaultSetting?.defaultCalendarId ?? this.options.oauth?.targetCalendarId ?? 'primary');
    const targetRevision = 'targetRevision' in record ? record.targetRevision : 1;
    if (
      record.userId !== binding.userId
      || record.connectionId !== binding.connectionId
      || record.connectionRevision !== binding.connectionRevision
      || record.googleSubjectId !== binding.googleSubjectId
      || calendarId !== binding.calendarId
      || targetRevision !== binding.targetRevision
    ) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
  }

  private admitMutation(): void {
    if (this.mutating) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Another Calendar setup change is already in progress.', false);
    }
    this.mutating = true;
  }

  private async clearLocal(current: CalendarConnectionRecord): Promise<boolean> {
    const disconnected = (record: CalendarConnectionRecord) => connectionRecordSchema.parse({
      ...record,
      enabled: false,
      status: 'disconnected',
      credentials: null,
      tokenExpiresAt: null,
      revision: record.revision + 1,
      connectionRevision: record.connectionRevision + 1,
      credentialVersion: record.credentials ? record.credentialVersion + 1 : record.credentialVersion,
      updatedAt: new Date(this.clock()).toISOString(),
    });
    let cas = await this.store.compareAndSwap(this.userId, current.revision, disconnected(current));
    if (cas.outcome === 'confirmed') return true;
    if (cas.outcome === 'uncertain') return false;
    const retry = await this.store.get(this.userId);
    if (!retry) return false;
    if (retry.status === 'disconnected') return true;
    cas = await this.store.compareAndSwap(this.userId, retry.revision, disconnected(retry));
    return cas.outcome === 'confirmed';
  }

  private needsRefresh(record: CalendarConnectionRecord | CalendarConnectionRecordV2): boolean {
    const expiresAt = record.tokenExpiresAt ? Date.parse(record.tokenExpiresAt) : NaN;
    if (!Number.isFinite(expiresAt)) return true;
    const remaining = expiresAt - this.clock();
    const margin = Math.min(ACCESS_MARGIN_MS, Math.max(0, remaining));
    return remaining <= margin || remaining <= 0;
  }

  private async refreshCurrentV2(
    record: CalendarConnectionRecordV2,
    account: CalendarAccountBinding,
    signal: AbortSignal,
    deadlineAt: string,
    consumeRefreshRequest: () => Promise<void>,
    force = false,
  ): Promise<void> {
    const key = `${record.connectionId}:${record.credentialVersion}`;
    if (this.refreshFlightV2 && this.refreshFlightV2.key === key) {
      await this.awaitFlight(this.refreshFlightV2.promise, signal, deadlineAt);
      return;
    }
    const leaderController = new AbortController();
    const promise = this.leadRefreshV2(record, account, signal, deadlineAt, consumeRefreshRequest, leaderController);
    this.refreshFlightV2 = { key, promise, controller: leaderController };
    try {
      await promise;
    } finally {
      if (this.refreshFlightV2?.promise === promise) this.refreshFlightV2 = null;
    }
  }

  private async leadRefreshV2(
    record: CalendarConnectionRecordV2,
    account: CalendarAccountBinding,
    signal: AbortSignal,
    deadlineAt: string,
    consumeRefreshRequest: () => Promise<void>,
    leaderController: AbortController,
  ): Promise<void> {
    await this.requireAccountCurrent(account, signal);
    let refreshToken: string;
    try {
      refreshToken = this.cipher.openToken(tokenAad(record, 'refresh'), record.credentials!.refresh);
    } catch {
      await this.markReconnectRequiredV2(record);
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    await consumeRefreshRequest();
    await this.requireAccountCurrent(account, signal);
    this.assertDeadline(deadlineAt, signal);

    const remaining = Date.parse(deadlineAt) - this.clock();
    const bound = AbortSignal.any([
      signal,
      leaderController.signal,
      this.closingController.signal,
      AbortSignal.timeout(Math.max(1, Math.min(CALENDAR_LIMITS.toolTimeoutMs, remaining))),
    ]);
    let refreshed;
    try {
      refreshed = await this.client.refresh({
        refreshToken, signal: bound, deadlineAt,
      });
    } catch (error) {
      if (error instanceof Error && 'failure' in error
        && (error as { failure?: { code?: string } }).failure?.code === 'RECONNECT_REQUIRED') {
        await this.markReconnectRequiredV2(record);
      }
      throw error;
    }
    const nextRefresh = refreshed.refreshToken ?? refreshToken;
    const nextScopes = refreshed.scopes ?? record.grantedScopes;
    if (!CALENDAR_SCOPES.every((scope) => nextScopes.includes(scope))) {
      await this.markReconnectRequiredV2(record);
      throw toolFault('credential', 'OAUTH_SCOPE_REJECTED');
    }

    let latest = await this.requireAccountCurrent(account, signal);
    if (latest.credentialVersion !== record.credentialVersion) {
      return;
    }
    const nextVersion = latest.credentialVersion + 1;
    const aad = { ...latest, credentialVersion: nextVersion };
    let next = calendarConnectionV2Schema.parse({
      ...latest,
      revision: latest.revision + 1,
      credentialVersion: nextVersion,
      credentials: {
        access: this.cipher.sealToken(tokenAad(aad, 'access'), refreshed.accessToken),
        refresh: this.cipher.sealToken(tokenAad(aad, 'refresh'), nextRefresh),
      },
      tokenExpiresAt: refreshed.expiresAt,
      grantedScopes: nextScopes,
      updatedAt: new Date(this.clock()).toISOString(),
    });

    let cas = await this.storeV2!.compareAndSwap({
      userId: this.userId,
      expectedRevision: latest.revision,
      expectedConnectionRevision: latest.connectionRevision,
      expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
      next,
    });
    if (cas.outcome === 'conflict') {
      latest = await this.requireAccountCurrent(account, signal);
      if (latest.credentialVersion === record.credentialVersion) {
        const rebasedAad = { ...latest, credentialVersion: nextVersion };
        next = calendarConnectionV2Schema.parse({
          ...latest,
          revision: latest.revision + 1,
          credentialVersion: nextVersion,
          credentials: {
            access: this.cipher.sealToken(tokenAad(rebasedAad, 'access'), refreshed.accessToken),
            refresh: this.cipher.sealToken(tokenAad(rebasedAad, 'refresh'), nextRefresh),
          },
          tokenExpiresAt: refreshed.expiresAt,
          grantedScopes: nextScopes,
          updatedAt: new Date(this.clock()).toISOString(),
        });
        cas = await this.storeV2!.compareAndSwap({
          userId: this.userId,
          expectedRevision: latest.revision,
          expectedConnectionRevision: latest.connectionRevision,
          expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
          next,
        });
      }
    }
    if (cas.outcome === 'uncertain') {
      this.hardFenced = true;
      throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
    }
    if (cas.outcome !== 'confirmed') {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
  }

  private async markReconnectRequiredV2(record: CalendarConnectionRecordV2): Promise<void> {
    const next = calendarConnectionV2Schema.parse({
      ...record,
      revision: record.revision + 1,
      connectionRevision: record.connectionRevision + 1,
      status: 'reconnect-required',
      discovery: null,
      updatedAt: new Date(this.clock()).toISOString(),
    });
    const cas = await this.storeV2!.compareAndSwap({
      userId: this.userId,
      expectedRevision: record.revision,
      expectedConnectionRevision: record.connectionRevision,
      expectedDefaultSettingRevision: record.defaultSetting.defaultSettingRevision,
      next,
    });
    this.lifecycleEpoch += 1;
    if (cas.outcome === 'confirmed' && this.onAccountInvalidated) {
      await this.onAccountInvalidated(
        {
          userId: record.userId,
          connectionId: record.connectionId,
          connectionRevision: record.connectionRevision,
          googleSubjectId: record.googleSubjectId,
        },
        'reconnect-required',
      );
    }
  }

  private fence(_reason: 'disconnect' | 'disabled'): void {
    this.executionFenced = true;
    this.lifecycleEpoch += 1;
    this.refreshFlight = null;
    this.refreshFlightV2?.controller.abort();
    this.refreshFlightV2 = null;
    this.discoveryService?.invalidate();
  }

  private assertDeadline(deadlineAt: string, signal: AbortSignal): void {
    if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (Date.parse(deadlineAt) <= this.clock()) throw toolFault('budget', 'CALENDAR_DEADLINE_EXCEEDED');
  }

  private async refreshCurrent(record: CalendarConnectionRecord, input: {
    binding: CalendarConnectionBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void>;
  }): Promise<void> {
    const key = `${record.connectionId}:${record.revision}:${record.credentialVersion}`;
    if (this.refreshFlight && this.refreshFlight.key === key) {
      await this.awaitFlight(this.refreshFlight.promise, input.signal, input.deadlineAt);
      return;
    }
    const promise = this.leadRefresh(record, input);
    this.refreshFlight = { key, promise };
    try {
      await promise;
    } finally {
      if (this.refreshFlight?.promise === promise) this.refreshFlight = null;
    }
  }

  private awaitFlight(promise: Promise<void>, signal: AbortSignal, deadlineAt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onAbort = () => finish(toolFault('cancelled', 'CALENDAR_CANCELLED'));
      const remaining = Date.parse(deadlineAt) - this.clock();
      const timer = setTimeout(() => finish(new AppError('TIMEOUT', 'Calendar setup timed out.', false)),
        Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(() => finish(), (error) => finish(error));
    });
  }

  private async leadRefresh(record: CalendarConnectionRecord, input: {
    binding: CalendarConnectionBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void>;
  }): Promise<void> {
    await this.requireCurrent(input.binding, input.signal);
    let refreshToken: string;
    try {
      refreshToken = this.cipher.openToken(tokenAad(record, 'refresh'), record.credentials!.refresh);
    } catch {
      await this.markReconnectRequired(record);
      throw toolFault('credential', 'RECONNECT_REQUIRED');
    }
    await input.consumeRefreshRequest();
    await this.requireCurrent(input.binding, input.signal);
    this.assertDeadline(input.deadlineAt, input.signal);
    const remaining = Date.parse(input.deadlineAt) - this.clock();
    const bound = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(Math.max(1, Math.min(CALENDAR_LIMITS.toolTimeoutMs, remaining))),
    ]);
    let refreshed;
    try {
      refreshed = await this.client.refresh({
        refreshToken, signal: bound, deadlineAt: input.deadlineAt,
      });
    } catch (error) {
      if (error instanceof Error && 'failure' in error
        && (error as { failure?: { code?: string } }).failure?.code === 'RECONNECT_REQUIRED') {
        await this.markReconnectRequired(record);
      }
      throw error;
    }
    const nextRefresh = refreshed.refreshToken ?? refreshToken;
    const nextScopes = refreshed.scopes ?? record.grantedScopes;
    if (!CALENDAR_SCOPES.every((scope) => nextScopes.includes(scope))) {
      await this.markReconnectRequired(record);
      throw toolFault('credential', 'OAUTH_SCOPE_REJECTED');
    }
    if (!this.isCurrentSnapshot({
      userId: this.userId,
      recordRevision: record.revision,
      lifecycleEpoch: this.lifecycleEpoch,
      redirectUri: this.options.oauth?.redirectUri ?? '',
      expectedGoogleSubjectId: record.googleSubjectId,
      connectionId: record.connectionId,
    }) && this.lifecycleEpoch) {
      /* lifecycle checked below via requireCurrent */
    }
    await this.requireCurrent(input.binding, input.signal);
    const latest = this.requireUsable(await this.store.get(this.userId), input.signal);
    const latestCalId = 'calendarId' in latest ? latest.calendarId : ((latest as CalendarConnectionRecordV2).defaultSetting?.defaultCalendarId ?? 'primary');
    const recordCalId = record.calendarId;
    if (latest.revision !== record.revision || latest.credentialVersion !== record.credentialVersion
      || latest.googleSubjectId !== record.googleSubjectId || latestCalId !== recordCalId) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    const credentialVersion = record.credentialVersion + 1;
    const aadBase = {
      userId: latest.userId, connectionId: latest.connectionId,
      credentialVersion, googleSubjectId: latest.googleSubjectId,
    };
    const next = connectionRecordSchema.parse({
      ...latest,
      revision: latest.revision + 1,
      credentialVersion,
      credentials: {
        access: this.cipher.sealToken(tokenAad(aadBase, 'access'), refreshed.accessToken),
        refresh: this.cipher.sealToken(tokenAad(aadBase, 'refresh'), nextRefresh),
      },
      tokenExpiresAt: refreshed.expiresAt,
      grantedScopes: nextScopes,
      updatedAt: new Date(this.clock()).toISOString(),
    });
    const cas = await this.store.compareAndSwap(this.userId, latest.revision, next);
    if (cas.outcome !== 'confirmed') {
      this.hardFenced = true;
      throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
    }
  }

  private async markReconnectRequired(record: CalendarConnectionRecord): Promise<void> {
    const next = connectionRecordSchema.parse({
      ...record,
      revision: record.revision + 1,
      connectionRevision: record.connectionRevision + 1,
      status: 'reconnect-required',
      updatedAt: new Date(this.clock()).toISOString(),
    });
    const cas = await this.store.compareAndSwap(this.userId, record.revision, next);
    this.lifecycleEpoch += 1;
    if (cas.outcome === 'confirmed') {
      await this.onInvalidated?.(this.bindingOf(record), 'reconnect-required');
    }
  }
}
