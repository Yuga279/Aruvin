/**
 * ============================================================================
 * FILE: app.service.ts
 * LOCATION: backend/src/app.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose persistence, assets, limits, runtime, voice, and operations once.
 *
 * ROLE IN PROJECT:
 *    Owns P9 initialization and diagnostic degradation so HTTP, voice, and
 *    operations modules share one observed runtime, one telemetry instance,
 *    and lazy archive delegates that fail closed when storage is unavailable.
 *
 * KEY COMPONENTS:
 *    - AppService.create: Load assets, open native storage, verify limits.
 *    - Single-owner voice: VoiceUsageService, VoiceSessionService, AgentVoiceAdapter.
 *    - Live bridge: Injected LiveKit admission/connect ports, epoch-fenced lifecycle,
 *      passive degradation, and one cleanup-uncertainty latch.
 *    - Lazy sessions/messages/users: Forward existing repositories or throw NOT_READY.
 *    - AuthService/AdministrationService: One provider, one deactivation hook.
 *    - httpOptions/attachTransport: P6 composition without a second runtime.
 *    - calendarFor/configFor: Per-owner Calendar assemblies and eligibility.
 * ============================================================================
 */

import { resolve } from 'node:path';
import type { SessionRepository, MessageRepository } from './contracts/repositories.js';
import { AppError } from './platform/errors/app-error.js';
import type { AurvinConfig } from './platform/config/load-config.js';
import type { BootstrapConfig } from './platform/config/bootstrap-config.js';
import {
  type CalendarBootstrap,
} from './platform/config/calendar-config.js';
import { parseCalendarSetupOptions, type CalendarSetupOptions }
  from './plugins/google-calendar/options.js';
import { CalendarDiscoveryApi } from './plugins/google-calendar/calendar-discovery-api.js';
import { CalendarOwnerRegistry } from './plugins/google-calendar/owner-registry.js';
import type { CalendarConnectionStore }
  from './contracts/calendar-connections.js';
import type { CalendarAccountBinding, CalendarConnectionStoreV2 }
  from './contracts/calendar-discovery.js';
import {
  calendarStatusV2ResponseSchema,
} from './contracts/calendar-wire.js';
import type { z } from 'zod';

type CalendarStatusV2Response = z.infer<typeof calendarStatusV2ResponseSchema>;
type OwnerCalendarAssembly = ReturnType<typeof createCalendarAssembly>;
import { createCalendarAssembly } from './operations/calendar-assembly.js';
import {
  buildRuntimeSnapshot,
  composeRuntimeBudgets,
  defaultManageableSettings,
  validateManageableSettings,
} from './platform/config/manageable-config.js';
import {
  MAX_CONFIG_DOCUMENT_BYTES,
  storedConfigDocumentSchema,
  type StoredConfigDocument,
} from './contracts/admin-config.js';
import type {
  AdminConfigActor,
  ConfigActivationPort,
  ConfigRepository,
  CurrentConfigPort,
  DecryptedCredentials,
  RuntimeConfigSnapshot,
  SnapshotCandidate,
} from './contracts/config-runtime.js';
import { assertFixedContextFits } from './context/context-budget.js';
import {
  AdminConfigService,
  AdminConfigFault,
  CredentialService,
  CredentialValidator,
} from './admin-config/index.js';
import { assertBytes } from './persistence/records.js';
import type { AuthPrincipal, UsersRepository } from './contracts/auth.js';
import { admitAccount, requireFullAccount } from './auth/access.js';
import { AuthFault } from './auth/errors.js';
import { AuthService } from './auth/auth.service.js';
import { createWorkosProvider, type AuthProvider } from './auth/provider.js';
import { AdministrationService } from './administration/administration.service.js';
import { RequestIdentityStore } from './platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from './platform/identity/server-identity-resolver.js';
import { openPersistence, MongoConfigRepository } from './persistence/index.js';
import { loadFixedAssets, type FixedAssets } from './instructions/fixed-assets.js';
import { ReferencedContextAssembler } from './context/index.js';
import { loadModelLimits } from './model/index.js';
import { calendarEvidenceFor } from './model/calendar-evidence.js';
import type { CalendarCatalogueEvidence } from './model/catalogue.js';
import { DurableChatRuntime, type ChatRuntime, type RuntimeDependencies } from './chat-runtime/index.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from './chat-runtime/memory-text.js';
import type { MemoryFirstPolicy } from './chat-runtime/memory-first-foundation.js';
import { OperationsService, Telemetry, observePersistence, writeStdoutLog } from './operations/index.js';
import { boundedResult } from './operations/bounded.js';
import type { ChatHttpOptions, ChatStreamTransport } from './http/index.js';
import { finishLocalMaintenanceForUsers } from './operations/local-recovery.js';
import type { ExecutionReservationPort, LiveKitAdmissionPort, LiveKitAdmissionTicket,
  SpeechUsage } from './contracts/voice.js';
import { ProviderFault, socketFactory, type SocketFactory } from './voice/providers/provider-link.js';
import { NovaSttAdapter } from './voice/providers/nova-stt.js';
import { FluxSttAdapter } from './voice/providers/flux-stt.js';
import { FluxTtsAdapter } from './voice/providers/flux-tts.js';
import { LiveKitAdmission } from './voice/session/livekit-admission.js';
import { VoiceSessionService, type VoiceBinding } from './voice/session/voice-session.service.js';
import { VoiceUpgradeAdmission } from './voice/transport/authenticated-ws-adapter.js';
import type { LiveKitMediaBridge } from './voice/transport/livekit-media.js';
import { VoiceSessionError, voiceError, type SessionContext, type VoiceFlow,
  type VoiceSink } from './voice/session/voice-session.options.js';
import { DictationFlow } from './voice/session/dictation-flow.js';
import { LiveFlow } from './voice/session/live-flow.js';
import { AgentVoiceAdapter, type VoiceBridgeRuntime } from './voice/agent/agent-voice-adapter.js';
import { VoiceUsageService } from './voice/usage/index.js';
import { VoiceAccounting } from './voice/usage/voice-accounting.js';

export type OpenedPersistence = Awaited<ReturnType<typeof openPersistence>>;
/** Frozen Calendar capability/pricing evidence for one configured model id. */
export type CalendarEvidenceLookup = (modelId: string) => CalendarCatalogueEvidence | null;
export type AssemblyPorts = {
  memoryFirstPolicy?: MemoryFirstPolicy | null;
  open: typeof openPersistence;
  assets: () => Promise<FixedAssets>;
  limits: typeof loadModelLimits;
  runtime: (dependencies: RuntimeDependencies) => ChatRuntime;
  fetcher: typeof fetch;
  writeLog: (line: string) => void;
  speechSockets?: SocketFactory;
  configRepository?: (opened: OpenedPersistence) => ConfigRepository;
  calendarConfig?: CalendarBootstrap;
  calendarEvidence?: CalendarEvidenceLookup;
  livekitAdmission?: LiveKitAdmissionPort;
  livekitConnect?: typeof LiveKitMediaBridge.connect;
  identities?: RequestIdentityStore;
  identity?: ServerIdentityResolver;
  authProvider?: (config: BootstrapConfig['workos']) => AuthProvider | null;
};

export function configurationAdapter(
  bootstrap: BootstrapConfig,
  snapshot: RuntimeConfigSnapshot,
): AurvinConfig {
  return {
    port: bootstrap.port,
    frontendOrigin: bootstrap.frontendOrigin,
    nodeEnv: bootstrap.nodeEnv,
    identity: bootstrap.identity,
    persistence: bootstrap.persistence,
    topology: bootstrap.topology,
    budgets: { ...snapshot.budgets },
    openRouter: { ...snapshot.openRouter },
    voice: snapshot.voice,
  };
}

export async function prepareConfigurationSnapshot(
  bootstrap: BootstrapConfig,
  candidate: SnapshotCandidate,
  assets: FixedAssets,
  limitsLoader: typeof loadModelLimits,
  fetcher: typeof fetch,
  signal: AbortSignal,
  evidenceFor: CalendarEvidenceLookup = calendarEvidenceFor,
): Promise<RuntimeConfigSnapshot> {
  const settings = validateManageableSettings(candidate.settings, bootstrap);
  const budgets = composeRuntimeBudgets(settings, bootstrap.safety);
  assertFixedContextFits(assets, budgets);
  const configured =
    Boolean(candidate.credentials.openrouter) && settings.openRouter.modelId !== '';
  const modelConfig = {
    identity: bootstrap.identity,
    budgets,
    openRouter: { ...settings.openRouter, apiKey: candidate.credentials.openrouter ?? '' },
  };
  // Frozen evidence pins known prices when present. Any other configured model
  // is admitted from the live catalogue when it lists tools and citeable rates.
  const evidence = configured ? evidenceFor(settings.openRouter.modelId) : null;
  const limits = configured
    ? await limitsLoader(modelConfig, signal, fetcher, evidence ?? undefined)
    : null;
  if (signal.aborted) throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
  return buildRuntimeSnapshot(bootstrap, { ...candidate, settings }, limits);
}

export class AppService {
  private opened: OpenedPersistence | null = null;
  private persistence: OpenedPersistence | null = null;
  private rawRuntime: ChatRuntime | null = null;
  private assetsOk = false;
  private cachedAssets: FixedAssets | null = null;
  private current: RuntimeConfigSnapshot | null = null;
  private lastPrepared: RuntimeConfigSnapshot | null = null;
  private readonly unconfigured: RuntimeConfigSnapshot;
  private configTarget: ConfigRepository | null = null;
  private localRecoveryPending = false;
  private configClosing = false;
  private configUncertain = false;
  private readonly configJobs = new Set<Promise<unknown>>();
  private transport: ChatStreamTransport | null = null;
  readonly config: AurvinConfig;
  readonly operations: OperationsService;
  readonly telemetry: Telemetry;
  readonly currentConfig: CurrentConfigPort;
  readonly activation: ConfigActivationPort;
  readonly adminConfig: AdminConfigService;
  private readonly ports: AssemblyPorts;
  private readonly credentials: CredentialService;
  readonly identities: RequestIdentityStore;
  readonly identity: ServerIdentityResolver;
  readonly authProvider: AuthProvider | null;
  readonly auth: AuthService;
  readonly administration: AdministrationService;
  readonly voiceUsage: VoiceUsageService;
  readonly voiceSessions: VoiceSessionService;
  readonly voiceUpgrades: VoiceUpgradeAdmission;
  private _voiceSessionsAssigned = false;
  private voiceAccountingFailed = false;
  private livekitDegraded = false;
  private voiceCleanupFailed = false;
  private readonly calendarOwners: CalendarOwnerRegistry<OwnerCalendarAssembly>;
  private readonly calendarSetup: CalendarSetupOptions;
  private readonly calendarPermission: CalendarBootstrap['permission'];
  private readonly calendarPolicyDeadlines: readonly number[];
  private readonly calendarStatusByOwner = new Map<string, CalendarStatusV2Response>();
  private readonly projectedByOwner = new Map<string, {
    base: RuntimeConfigSnapshot; eligible: boolean; projected: RuntimeConfigSnapshot;
  }>();
  private readonly processClosing = new AbortController();
  private projectedBase: RuntimeConfigSnapshot | null = null;
  private projectedEligible = false;
  private projectedCurrent: RuntimeConfigSnapshot | null = null;

  readonly sessions: SessionRepository = {
    get: (u, s) => this.store().sessions.get(u, s),
    list: (u, p) => this.store().sessions.list(u, p),
    createIfAbsent: r => this.store().sessions.createIfAbsent(r),
    touchActivity: (u, s, at) => this.store().sessions.touchActivity(u, s, at),
    update: (u, s, changes) => this.store().sessions.update(u, s, changes),
    delete: (u, s) => this.store().sessions.delete(u, s),
  };
  readonly messages: MessageRepository = {
    listPublished: (u, s, p, maxSequence) => this.store().messages.listPublished(u, s, p, maxSequence),
    append: r => this.store().messages.append(r),
    list: (u, s, p) => this.store().messages.list(u, s, p),
    get: (u, s, m) => this.store().messages.get(u, s, m),
    updateCompletion: (u, s, m, status, truncated) =>
      this.store().messages.updateCompletion(u, s, m, status, truncated),
  };
  readonly users: UsersRepository = {
    get: userId => this.store().users.get(userId),
    bySubject: workosUserId => this.store().users.bySubject(workosUserId),
    byEmail: email => this.store().users.byEmail(email),
    insert: account => this.trackConfigJob(() => this.store().users.insert(account)),
    compareAndSwap: (expected, next) => this.trackConfigJob(() => this.store().users.compareAndSwap(expected, next)),
    list: options => this.store().users.list(options),
  };

  private constructor(readonly bootstrap: BootstrapConfig, overrides: Partial<AssemblyPorts>) {
    if (bootstrap.topology.executor !== 'single-process') {
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'Only one executor is supported.');
    }
    if (new URL(bootstrap.frontendOrigin).origin !== bootstrap.frontendOrigin) {
      throw new AppError('CONFIGURATION_ERROR', 'Configure one exact frontend origin.');
    }
    this.ports = {
      open: openPersistence,
      assets: () => loadFixedAssets({
        instructions: resolve(process.cwd(), 'src/instructions/system.md'),
        knowledge: resolve(process.cwd(), '../product_knowledge.md'),
      }),
      limits: loadModelLimits,
      runtime: d => new DurableChatRuntime(d),
      fetcher: fetch,
      writeLog: line => { writeStdoutLog(line); },
      ...overrides,
    };
    this.telemetry = new Telemetry(this.ports.writeLog);
    // Infrastructure/default adapter before storage opens. Manageable defaults
    // here are not an active revision and never override stored settings.
    this.unconfigured = buildRuntimeSnapshot(bootstrap, {
      revision: 0,
      settings: defaultManageableSettings(),
      credentials: { openrouter: null, deepgram: null },
    }, null);
    this.config = configurationAdapter(bootstrap, this.unconfigured);
    this.identities = overrides.identities ?? new RequestIdentityStore();
    this.identity = overrides.identity ?? new ServerIdentityResolver(this.identities);
    this.authProvider = (overrides.authProvider ?? (config => config ? createWorkosProvider(config) : null))(
      bootstrap.workos ?? null);
    this.auth = new AuthService({ users: this.users, provider: this.authProvider });
    const logout = this.auth.logout.bind(this.auth);
    this.auth.logout = async principal => {
      try { await logout(principal); }
      finally {
        this.transport?.closeUser(principal.identity.userId, principal.sessionId);
        await this.voiceSessions.stopUser(principal.identity.userId, principal.sessionId);
        this.calendarOwners.get(principal.identity.userId)?.oauth.cancelPending(principal.sessionId);
      }
    };
    this.administration = new AdministrationService({
      users: this.users, provider: this.authProvider,
      onUserDeactivated: userId => this.onUserDeactivated(userId),
    });
    this.credentials = new CredentialService(
      bootstrap.encryption, new CredentialValidator(this.ports.fetcher));
    const calendarConfig = this.ports.calendarConfig ?? bootstrap.calendar ?? {
      setup: parseCalendarSetupOptions({}),
      permission: {
        content: 'volatile' as const, minimalEvidenceAllowed: false, policyId: 'calendar-unconfigured',
      },
      policyDeadlines: [],
      trustedTimeZone: 'Etc/UTC',
    };
    this.calendarSetup = calendarConfig.setup;
    this.calendarPermission = calendarConfig.permission;
    this.calendarPolicyDeadlines = calendarConfig.policyDeadlines;
    const calendarStore: CalendarConnectionStore = {
      get: userId => this.persistence
        ? this.persistence.calendarConnections.get(userId) : Promise.resolve(null),
      create: record => this.trackConfigJob(async () => {
        const p = this.store();
        await p.owner.assertExecutor();
        const result = await p.calendarConnections.create(record);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
      compareAndSwap: (userId, revision, next) => this.trackConfigJob(async () => {
        const p = this.store();
        await p.owner.assertExecutor();
        const result = await p.calendarConnections.compareAndSwap(userId, revision, next);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
      putState: record => this.trackConfigJob(async () => {
        const p = this.store();
        await p.owner.assertExecutor();
        await p.calendarConnections.putState(record);
      }),
      consumeState: request => this.trackConfigJob(async () => {
        const p = this.store();
        await p.owner.assertExecutor();
        return p.calendarConnections.consumeState(request);
      }),
    };
    // The v2 connection store is the same single persistence owner as the v1
    // store, reached lazily because persistence opens after this composition.
    const calendarStoreV2: CalendarConnectionStoreV2 = {
      get: userId => this.persistence
        ? this.persistence.calendarConnectionsV2.get(userId) : Promise.resolve(null),
      create: record => this.trackConfigJob(async () => {
        await this.assertConfigWritable();
        const result = await this.store().calendarConnectionsV2.create(record);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
      compareAndSwap: input => this.trackConfigJob(async () => {
        await this.assertConfigWritable();
        const result = await this.store().calendarConnectionsV2.compareAndSwap(input);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
    };
    this.calendarOwners = new CalendarOwnerRegistry(userId => {
      const assembled = createCalendarAssembly({
        config: calendarConfig,
        encryption: bootstrap.encryption,
        userId,
        store: calendarStore,
        storeV2: calendarStoreV2,
        discovery: new CalendarDiscoveryApi({ fetcher: this.ports.fetcher,
          diagnostic: fields => this.telemetry.event('process', fields) }),
        fetcher: this.ports.fetcher,
        onAccountInvalidated: (account, reason) => this.onCalendarInvalidated(account, reason),
        diagnostic: fields => this.telemetry.event('process', fields),
      });
      this.wrapCalendarLifecycle(assembled, userId);
      return assembled;
    });
    this.currentConfig = { current: () => this.projectCurrent() };
    this.activation = {
      prepare: candidate => this.prepareSnapshot(candidate),
      publish: snapshot => this.publishSnapshot(snapshot),
    };
    const repository: ConfigRepository = {
      read: () => this.readStoredStrict(),
      createIfAbsent: async document => this.trackConfigJob(async () => {
        const result = await this.requireConfigTarget().createIfAbsent(document);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
      compareAndSwap: async (expected, document) => this.trackConfigJob(async () => {
        const result = await this.requireConfigTarget().compareAndSwap(expected, document);
        if (result.outcome === 'uncertain') this.configUncertain = true;
        return result;
      }),
    };
    this.adminConfig = new AdminConfigService({
      bootstrap,
      repository,
      credentials: this.credentials,
      activation: this.activation,
      current: this.currentConfig,
      assertWritable: () => this.assertConfigWritable(),
    });
    // Track admin mutation calls and their underlying repository jobs so
    // shutdown drains dispatched writes instead of releasing the sentinel.
    // A timed-out P2 response does not mean its driver operation stopped.
    const save = this.adminConfig.saveSettings.bind(this.adminConfig);
    this.adminConfig.saveSettings = (raw, actor) => this.trackConfigJob(() => save(raw, actor));
    const update = this.adminConfig.updateCredential.bind(this.adminConfig);
    this.adminConfig.updateCredential = (provider, raw, actor) =>
      this.trackConfigJob(() => update(provider, raw, actor));
    const voiceConfig = this.config.voice ?? this.unconfigured.voice;
    this.voiceUsage = new VoiceUsageService({
      config: voiceConfig,
      currentConfig: this.currentConfig,
      now: Date.now,
      admissionPerMinute: this.config.budgets.maxRequestsPerMinutePerUser,
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      },
      stop: (sessionId, reason) => this.voiceSessions.stop(sessionId, reason),
      warn: (sessionId, code) => this.voiceSessions.warn(sessionId, code),
      writeLog: (line) => { this.ports.writeLog(line); },
    });
    this.voiceSessions = new VoiceSessionService({
      config: voiceConfig,
      currentConfig: this.currentConfig,
      assertAccountCurrent: async principal => {
        const current = this.persistence
          ? await this.store().users.get(principal.identity.userId) : null;
        const admitted = admitAccount(current?.account ?? null, principal.sessionId);
        requireFullAccount(admitted);
        if (admitted.account.sessionEpoch !== principal.account.sessionEpoch)
          throw new AuthFault('UNAUTHENTICATED');
      },
      sessions: { get: async (u, s) => this.rawRuntime?.memorySession?.(u, s) ?? this.sessions.get(u, s) },
      reservations: this.reservations(),
      livekit: this.ports.livekitAdmission ?? new LiveKitAdmission(),
      frontendOrigin: bootstrap.frontendOrigin,
      secureCookie: new URL(bootstrap.frontendOrigin).protocol === 'https:',
      admission: (context) => this.voiceUsage.admission(context),
      usage: (context, usage) => this.voiceUsage.usage(context, usage),
      disconnected: (context) => this.voiceUsage.disconnected(context),
      open: (context, sink, signal) => this.openVoice(context, sink, signal),
      openLiveBridge: (context, ticket) => this.openLiveBridge(context, ticket),
      observe: (context, event) => this.voiceUsage.observe(context, event),
    });
    this._voiceSessionsAssigned = true;
    const frontend = new URL(bootstrap.frontendOrigin);
    this.voiceUpgrades = new VoiceUpgradeAdmission(
      this.auth,
      {
        frontendOrigin: bootstrap.frontendOrigin,
        secureCookie: frontend.protocol === 'https:',
        developmentLoopback: bootstrap.nodeEnv !== 'production',
        trustedHttpsIngress: req => {
          const peer = req.socket.remoteAddress;
          return (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1')
            && req.headers['x-forwarded-proto'] === 'https';
        },
      },
    );
    this.operations = new OperationsService({
      config: this.config, currentConfig: this.currentConfig, runtime: () => this.rawRuntime,
      assetsReady: () => this.assetsOk, modelLimitsReady: () => this.current?.modelLimits != null,
      ping: () => this.opened?.ping() ?? Promise.resolve(false),
      assertExecutor: async () => { await this.store().owner.assertExecutor(); },
      closePersistence: async () => {
        // Guard journal/ownership health before release; unknown writes keep
        // the sentinel. Diagnostic boot without storage has nothing to close.
        if (!this.opened) return;
        await this.opened.owner.assertExecutor();
        await this.opened.close();
      },
      stopConfig: () => { this.configClosing = true; },
      stopVoice: () => {
        this.voiceSessions.stopAccepting();
        this.voiceUsage.stopAccepting();
      },
      drainConfig: (ms: number) => this.drainConfigJobs(ms),
      stopCalendar: () => {
        this.processClosing.abort();
        for (const owner of this.calendarOwners.values()) {
          void this.trackConfigJob(() => owner.connections.close());
        }
      },
      drainCalendar: async (ms: number) => {
        const jobs = await this.drainConfigJobs(ms);
        let active = 0;
        for (const owner of this.calendarOwners.values()) {
          await owner.execution.close();
          active += owner.execution.activeExecutions;
        }
        return {
          drained: jobs.drained && active === 0,
          active,
          unresolvedWrites: jobs.unresolvedWrites,
        };
      },
      transportSnapshot: () => this.transport?.snapshot() ?? { active: 0, backpressured: 0 },
      writeLog: this.ports.writeLog,
      speechDegraded: () => this.voiceUsage.speechStatus().degraded || this.livekitDegraded,
      drainVoice: async () => {
        await this.voiceSessions.drain();
        const result = await this.voiceUsage.drain();
        if (this.voiceAccountingFailed || this.voiceCleanupFailed) {
          throw new AppError('PERSISTENCE_ERROR', 'Voice cleanup could not be confirmed.');
        }
        return result;
      },
      voiceSnapshot: () => this.voiceUsage.snapshot(),
      calendarSnapshot: () => this.calendarHealthSnapshot(),
      authenticationReady: () => this.authProvider !== null && this.persistence !== null,
    }, this.telemetry);
  }

  static async create(bootstrap: BootstrapConfig, ports: Partial<AssemblyPorts> = {}) {
    const service = new AppService(bootstrap, ports);
    await service.initialize();
    return service;
  }
  adminActor(): AdminConfigActor {
    return this.identities.adminActor();
  }
  onUserDeactivated(userId: string): void | Promise<void> {
    const calendar = this.calendarOwners.get(userId);
    calendar?.oauth.cancelPending();
    calendar?.connections.cancelPendingWork();
    return Promise.allSettled([
      this.rawRuntime?.interruptUser?.(userId) ?? Promise.resolve(),
      Promise.resolve(this.transport?.closeUser(userId)),
      this.voiceSessions.stopUser(userId),
    ]).then(results => {
      if (results.some(result => result.status === 'rejected'))
        this.telemetry.event('process', { state: 'error', stage: 'runtime-error' });
    });
  }
  private store(): OpenedPersistence {
    if (!this.persistence) throw new AppError('NOT_READY', 'Chat storage is unavailable.');
    return this.persistence;
  }
  private requireConfigTarget(): ConfigRepository {
    const target = this.configTarget;
    if (!target) throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    return target;
  }
  private trackConfigJob<T>(run: () => Promise<T>): Promise<T> {
    const job = Promise.resolve().then(run);
    this.configJobs.add(job);
    void job.then(
      () => this.configJobs.delete(job),
      () => this.configJobs.delete(job),
    );
    return job;
  }
  calendarFor(userId: string): OwnerCalendarAssembly {
    return this.calendarOwners.forUser(userId);
  }
  configFor(userId: string): RuntimeConfigSnapshot | null {
    const base = this.current;
    if (!base) return null;
    const eligible = this.ownerCalendarEligible(userId);
    const cached = this.projectedByOwner.get(userId);
    if (cached && cached.base === base && cached.eligible === eligible) return cached.projected;
    const calendar = Object.freeze({ ...this.calendarSetup.initial, enabled: eligible });
    const projected = Object.freeze({ ...base, calendar });
    this.projectedByOwner.set(userId, { base, eligible, projected });
    return projected;
  }
  async prepareOwner(principal: AuthPrincipal): Promise<void> {
    await boundedResult(
      this.refreshCalendarStatus(principal.identity.userId),
      this.config.budgets.persistenceTimeoutMs,
    );
  }
  private calendarHealthSnapshot(): {
    state: 'disabled' | 'setup-required' | 'connected' | 'reconnect-required' | 'degraded';
    enabled: boolean;
  } {
    const tools = this.current?.modelLimits?.calendar?.tools === true
      && this.current.modelLimits.calendar.pricing != null;
    const storage = this.persistence != null && !this.configUncertain;
    const policy = this.calendarPolicyCurrent();
    const configured = this.calendarConfigured();
    if (!storage || (configured && (!policy || !tools))) {
      return { state: 'degraded', enabled: false };
    }
    if (!configured) return { state: 'disabled', enabled: false };
    return { state: 'connected', enabled: true };
  }
  private calendarConfigured(): boolean {
    return this.calendarSetup.oauth !== null
      && this.calendarSetup.realDataPolicyApproved
      && this.calendarPolicyCurrent();
  }
  private ownerCalendarEligible(userId: string): boolean {
    const status = this.calendarStatusByOwner.get(userId);
    if (!status) return false;
    const tools = this.current?.modelLimits?.calendar?.tools === true
      && this.current.modelLimits.calendar.pricing != null;
    const storage = this.persistence != null && !this.configUncertain;
    const policy = this.calendarPolicyCurrent();
    const configured = this.calendarOwners.get(userId)?.connections.isConfigured() === true;
    if (!storage || this.configClosing) return false;
    if (status.enabled && configured && (!policy || !tools)) return false;
    return status.enabled === true && status.state !== 'reconnect-required'
      && status.connectionRevision != null && configured && policy;
  }
  private calendarPolicyCurrent(): boolean {
    return this.calendarPermission.minimalEvidenceAllowed
      && this.calendarPolicyDeadlines.length > 0
      && this.calendarPolicyDeadlines.every(at => at > Date.now());
  }
  private projectCurrent(): RuntimeConfigSnapshot | null {
    const base = this.current;
    if (!base) return null;
    const eligible = this.calendarHealthSnapshot().enabled && !this.configClosing;
    if (this.projectedCurrent && this.projectedBase === base && this.projectedEligible === eligible) {
      return this.projectedCurrent;
    }
    const calendar = Object.freeze({ ...this.calendarSetup.initial, enabled: eligible });
    const projected = Object.freeze({ ...base, calendar });
    this.projectedBase = base;
    this.projectedEligible = eligible;
    this.projectedCurrent = projected;
    return projected;
  }
  private async refreshCalendarStatus(userId: string): Promise<void> {
    try {
      await this.calendarFor(userId).connections.statusV2();
    } catch {
      this.calendarStatusByOwner.set(userId, calendarStatusV2ResponseSchema.parse({
        protocolVersion: 2, state: 'degraded', enabled: false,
        accountEmail: null, processingDisclosure: null,
        connectionRevision: null, defaultSetting: null, primaryCalendarId: null,
        discovery: null, missingScopes: [],
      }));
      this.projectedByOwner.delete(userId);
    }
  }
  private async onCalendarInvalidated(
    account: CalendarAccountBinding,
    reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required',
  ): Promise<void> {
    const prior = this.calendarStatusByOwner.get(account.userId);
    this.calendarStatusByOwner.set(account.userId, calendarStatusV2ResponseSchema.parse({
      protocolVersion: 2,
      state: reason === 'reconnect-required' ? 'reconnect-required' : 'disabled',
      enabled: false,
      accountEmail: null,
      processingDisclosure: prior?.processingDisclosure ?? null,
      connectionRevision: null, defaultSetting: null, primaryCalendarId: null,
      discovery: null, missingScopes: [],
    }));
    this.projectedByOwner.delete(account.userId);
    await this.redactInvalidatedRevision(account, reason);
  }
  private async redactInvalidatedRevision(
    account: CalendarAccountBinding,
    reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required',
  ): Promise<void> {
    const runtime = this.rawRuntime;
    (runtime as ChatRuntime & { invalidateCalendarAccount?: (account: CalendarAccountBinding, reason: string) => void })?.invalidateCalendarAccount?.(account, reason);
    if (!runtime?.quiesceStreams || !runtime.releaseStreamFence) {
      throw new AppError('NOT_READY', 'Stream quiescence is unavailable.', false);
    }
    const q = await runtime.quiesceStreams(this.config.budgets.shutdownDrainMs);
    if (!q.drained) {
      throw new AppError('NOT_READY', 'Chat streams did not drain.', false);
    }
    const now = new Date().toISOString();
    const limit = this.config.budgets.maxPageSize;
    for (let cursor: string | null = null; ;) {
      const page = await this.store().calendarRetention.invalidateAccountRevisionPage({
        account, now, cursor, limit,
      });
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    runtime.clearConfirmedState?.();
    runtime.releaseStreamFence();
  }
  private admitCalendarMutation<T>(
    userId: string,
    signal: AbortSignal,
    requirePolicy: boolean,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.configClosing) {
      throw new AppError('NOT_READY', 'Calendar setup is not ready.', false);
    }
    if (requirePolicy && !this.calendarPolicyCurrent()) {
      throw new AppError('NOT_READY', 'Calendar policy is unavailable.', false);
    }
    const combined = AbortSignal.any([signal, this.processClosing.signal]);
    return this.trackConfigJob(async () => {
      try {
        return await run(combined);
      } finally {
        await this.refreshCalendarStatus(userId);
      }
    });
  }
  private wrapCalendarLifecycle(owner: OwnerCalendarAssembly, userId: string): void {
    const connections = owner.connections;
    const oauth = owner.oauth;
    const settings = connections.settings.bind(connections);
    const disconnect = connections.disconnect.bind(connections);
    const installGrant = connections.installGrant.bind(connections);
    const refreshCalendars = connections.refreshCalendars.bind(connections);
    const statusV2 = connections.statusV2.bind(connections);
    const start = oauth.start.bind(oauth);
    const callback = oauth.callback.bind(oauth);
    connections.statusV2 = async () => {
      const status = calendarStatusV2ResponseSchema.parse(await statusV2());
      this.calendarStatusByOwner.set(userId, status);
      this.projectedByOwner.delete(userId);
      return status;
    };
    connections.settings = (request, signal) =>
      this.admitCalendarMutation(userId, signal, false, combined => settings(request, combined));
    connections.disconnect = (request, signal) =>
      this.admitCalendarMutation(userId, signal, false, combined => disconnect(request, combined));
    connections.installGrant = input =>
      this.admitCalendarMutation(userId, input.signal, true, combined => installGrant({ ...input, signal: combined }));
    connections.refreshCalendars = (request, signal) =>
      this.admitCalendarMutation(userId, signal, true, combined => refreshCalendars(request, combined));
    oauth.start = (signal, authSessionId) =>
      this.admitCalendarMutation(userId, signal, true, combined => start(combined, authSessionId));
    oauth.callback = (input, signal, authSessionId) =>
      this.admitCalendarMutation(userId, signal, true, combined => callback(input, combined, authSessionId));
  }
  private async drainConfigJobs(ms: number): Promise<{ drained: boolean; unresolvedWrites: number }> {
    const deadline = Date.now() + ms;
    for (;;) {
      const pending = [...this.configJobs];
      if (pending.length === 0) {
        return this.configUncertain
          ? { drained: false, unresolvedWrites: 1 }
          : { drained: true, unresolvedWrites: 0 };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { drained: false, unresolvedWrites: pending.length + (this.configUncertain ? 1 : 0) };
      }
      await boundedResult(Promise.allSettled(pending), remaining);
    }
  }
  private async readStoredStrict(): Promise<StoredConfigDocument | null> {
    const raw = await this.requireConfigTarget().read();
    if (raw === null) return null;
    const parsed = storedConfigDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new AdminConfigFault('CONFIG_STORED_INVALID');
    try {
      assertBytes(parsed.data,
        Math.min(MAX_CONFIG_DOCUMENT_BYTES, this.bootstrap.safety.maxDocumentBytes));
    } catch {
      throw new AdminConfigFault('CONFIG_STORED_INVALID');
    }
    try {
      validateManageableSettings(parsed.data.settings, this.bootstrap);
    } catch {
      throw new AdminConfigFault('CONFIG_STORED_INVALID');
    }
    return parsed.data;
  }
  private async assertConfigWritable(): Promise<void> {
    if (this.configClosing || this.localRecoveryPending) {
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    }
    if (this.configUncertain) throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN');
    await this.store().owner.assertExecutor();
  }
  private async prepareSnapshot(candidate: SnapshotCandidate): Promise<RuntimeConfigSnapshot> {
    const assets = this.cachedAssets;
    if (!assets) throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    const snapshot = await prepareConfigurationSnapshot(
      this.bootstrap, candidate, assets, this.ports.limits, this.ports.fetcher,
      new AbortController().signal, this.ports.calendarEvidence);
    this.lastPrepared = snapshot;
    return snapshot;
  }
  private publishSnapshot(snapshot: RuntimeConfigSnapshot): void {
    if (this.configClosing || this.configUncertain || this.localRecoveryPending) {
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    }
    if (this.rawRuntime?.snapshot().degraded) {
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    }
    if (snapshot !== this.lastPrepared) {
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    }
    if (snapshot.revision <= (this.current?.revision ?? -1)) {
      throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
    }
    this.current = snapshot;
  }
  private createRuntime(assets: FixedAssets): ChatRuntime {
    const persistence = this.store();
    const assembler = new ReferencedContextAssembler({
      memory: persistence.memory, messages: persistence.messages,
      metadata: persistence.metadata,
      budgets: this.config.budgets, assets,
    });
    const snapshot = this.current;
    return this.ports.runtime({
      config: this.config, persistence, assembler, assets,
      limits: snapshot?.modelLimits ?? undefined,
      currentConfig: this.currentConfig, fetcher: this.ports.fetcher,
      calendarFor: userId => this.calendarFor(userId).runtime,
      configFor: userId => this.configFor(userId),
      ...(this.ports.memoryFirstPolicy === null ||
      (this.ports.memoryFirstPolicy === undefined && !persistence.owner.store)
        ? {}
        : {
            memoryFirst: {
              voice: true,
              policy: this.ports.memoryFirstPolicy ?? {
                ...PROPOSED_MEMORY_TEXT_POLICY,
                shutdownDrainMs: this.config.budgets.shutdownDrainMs,
                writeTimeoutMs: this.config.budgets.persistenceTimeoutMs,
              },
            },
          }),
      diagnostics: {
        emit: fields => this.telemetry.event('process', fields),
        run: (scope, work) => this.telemetry.inDiagnosticScope(scope, work),
      },
    });
  }
  private async loadPointer(assets: FixedAssets): Promise<RuntimeConfigSnapshot | null> {
    let stored: StoredConfigDocument | null;
    try {
      stored = await this.readStoredStrict();
    } catch (error) {
      this.telemetry.event('readiness', { ok: false, code:
        error instanceof AdminConfigFault && error.code === 'CONFIG_STORED_INVALID'
          ? 'CONFIG_STORED_INVALID' : 'NOT_READY' });
      return null;
    }
    if (stored === null) return this.unconfigured;
    let decrypted: DecryptedCredentials;
    try {
      decrypted = this.credentials.decrypt(stored);
    } catch {
      this.telemetry.event('readiness', { ok: false, code: 'CONFIG_ENCRYPTION_UNAVAILABLE' });
      return null;
    }
    try {
      return await prepareConfigurationSnapshot(
        this.bootstrap,
        { revision: stored.revision, settings: stored.settings, credentials: decrypted },
        assets, this.ports.limits, this.ports.fetcher, new AbortController().signal,
        this.ports.calendarEvidence);
    } catch {
      this.telemetry.event('readiness', { ok: false, code: 'CONFIGURATION_ERROR' });
      return null;
    }
  }
  private async initialize() {
    const assets = await this.ports.assets();
    this.cachedAssets = assets;
    this.assetsOk = true;
    if (!this.bootstrap.persistence.mongoUri
      || this.bootstrap.persistence.profile !== 'native-mongodb') {
      // Diagnostic liveness only: admin reports storage unavailable, chat waits.
      this.telemetry.event('readiness', { ok: false, code: 'NOT_READY' });
      return;
    }
    let opened: OpenedPersistence;
    try {
      opened = await this.ports.open(this.config);
    } catch (error) {
      // A second/stale executor is a hard startup failure, not an unnoticed fallback.
      if (this.bootstrap.topology.localCrashRecovery
        || error instanceof AppError && error.code === 'UNSUPPORTED_TOPOLOGY') throw error;
      this.telemetry.event('readiness', { ok: false, code: 'NOT_READY' });
      return;
    }
    this.opened = opened;
    this.persistence = { ...observePersistence(opened, this.telemetry), close: opened.close };
    this.configTarget = this.ports.configRepository
      ? this.ports.configRepository(opened)
      : new MongoConfigRepository(opened.owner.store, opened.owner,
        Math.min(MAX_CONFIG_DOCUMENT_BYTES, this.bootstrap.safety.maxDocumentBytes));
    this.current = await this.loadPointer(assets);
    try {
      if (this.bootstrap.topology.localCrashRecovery) {
        const observed = await opened.owner.observedExecutor();
        if (!observed.record.local) throw new AppError('NOT_READY', 'Local recovery evidence is unavailable.');
        if (this.current === null) {
          // Catalogue/schema/encryption failure keeps pending recovery retained.
          this.localRecoveryPending = true;
          this.telemetry.event('readiness', { ok: false, code: 'NOT_READY' });
          return;
        }
        this.localRecoveryPending = true;
        const mapped = await this.users.get(this.bootstrap.identity.userId);
        if (!mapped) {
          const leftover = await this.persistence.sessions.listForRecovery(
            this.bootstrap.identity.userId, { cursor: null, limit: 1 });
          if (leftover.items.length)
            throw new AppError('NOT_READY', 'Unmapped legacy chat data requires explicit operator adoption.');
        }
        this.rawRuntime = await finishLocalMaintenanceForUsers(opened.owner, this.persistence.sessions,
          this.users, observed.record.local.ancestors,
          this.config.budgets.shutdownDrainMs, () => this.createRuntime(assets));
        this.localRecoveryPending = false;
      } else {
        // One admitted runtime even while unconfigured; P3 admission rejects inference.
        this.rawRuntime = this.createRuntime(assets);
      }
    } catch {
      await this.operations.shutdown();
      throw new AppError('NOT_READY', 'Chat initialization failed.');
    }
  }
  attachTransport(transport: ChatStreamTransport) { this.transport = transport; }
  httpOptions(identity: ServerIdentityResolver): ChatHttpOptions {
    const voice = this.voiceRuntime();
    return {
      runtime: this.operations.runtime,
      sessions: this.sessions,
      messages: this.messages,
      identity,
      principal: () => this.identities.principal(),
      budgets: this.config.budgets,
      currentConfig: { current: () => this.configFor(identity.resolve().userId) },
      ...(voice ? { executionReservations: voice.reservations } : {}),
    };
  }
  private voiceRuntime(): (VoiceBridgeRuntime & { reservations: ExecutionReservationPort & { assertText(userId: string, sessionId: string): void } }) | null {
    const runtime = this.rawRuntime;
    if (!runtime || !('reservations' in runtime) || !('submitLiveTurn' in runtime)) return null;
    return runtime as VoiceBridgeRuntime & { reservations: ExecutionReservationPort & { assertText(userId: string, sessionId: string): void } };
  }

  private reservations(): ExecutionReservationPort {
    return {
      acquire: async (command) => {
        const runtime = this.voiceRuntime();
        if (!runtime) throw new VoiceSessionError('VOICE_DISABLED');
        return runtime.reservations.acquire(command);
      },
      bindConversation: async (command) => {
        const runtime = this.voiceRuntime();
        if (!runtime) throw new VoiceSessionError('VOICE_DISABLED');
        return runtime.reservations.bindConversation(command);
      },
      release: async (command) => {
        const runtime = this.voiceRuntime();
        if (!runtime) return;
        return runtime.reservations.release(command);
      },
    };
  }

  private speechSockets(): SocketFactory {
    const factory = this.ports.speechSockets ?? socketFactory;
    return (url, headers) => {
      const socket = factory(url, headers);
      socket.on('error', () => this.voiceUsage.degrade());
      return socket;
    };
  }

  private async openLiveBridge(context: SessionContext, ticket: LiveKitAdmissionTicket) {
    // P2 issue(entry) passes the registry object itself; identity is asserted below.
    const binding = context as VoiceBinding;
    const sessionId = context.response.sessionId;
    const epoch = context.response.connectionEpoch;
    const descriptor = { ...ticket.transport };
    let claimed = false;
    const current = () => binding.response.connectionEpoch === epoch && binding.state !== 'ended';
    try {
      const media = await import('./voice/transport/livekit-media.js');
      const connect = this.ports.livekitConnect
        ?? (options => media.LiveKitMediaBridge.connect(options));
      const bridge = await connect({ context, ticket,
        open: async (c, sink, signal) => {
          if (!current()) throw new VoiceSessionError('STALE_CONNECTION_EPOCH');
          if (!claimed) {
            const owner = this.voiceSessions.claimLive(sessionId,
              descriptor.participantIdentity, descriptor.roomName);
            if (owner !== binding) throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
            claimed = true;
          }
          const flow = await this.openVoice(c, sink, signal);
          if (!(flow instanceof LiveFlow)) {
            await flow.close();
            throw new VoiceSessionError('VOICE_INVALID_STATE');
          }
          return flow;
        },
        ended: async () => {
          if (current()) await this.voiceSessions.end(sessionId);
        },
        disconnected: async recoverable => {
          if (current()) await this.voiceSessions.disconnected(binding, recoverable);
        },
        observe: observation => {
          if (!current()) return;
          if (observation.stage === 'transport-error') this.livekitDegraded = true;
          this.voiceUsage.observe(context, observation);
        },
      });
      this.livekitDegraded = false;
      binding.warning = code => bridge.event({ type: 'session.warning', code,
        recovery: 'none', recoverable: true });
      binding.pause = async reason => {
        bridge.pause(reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED', false);
        bridge.event({ type: 'session.ended', reason, terminal: false });
      };
      binding.terminal = reason => bridge.event({ type: 'session.ended', reason, terminal: true });
      return { close: async () => {
        try { await bridge.dispose(); }
        catch (error) { this.voiceCleanupFailed = true; throw error; }
      } };
    } catch (error) {
      this.livekitDegraded = true;
      throw voiceError(error, 'VOICE_CONNECT_TIMEOUT');
    }
  }

  private async openVoice(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<VoiceFlow> {
    const sockets = this.speechSockets();
    const usage = (current: SessionContext, speech: SpeechUsage) => this.voiceUsage.usage(current, speech);
    const voiceConfig = context.voiceConfig;
    const accounting = new VoiceAccounting({
      userId: context.identity.userId, voiceSessionId: context.response.sessionId,
      conversationId: () => context.reservation?.conversationId ?? context.response.conversationId,
      config: voiceConfig,
      write: async record => {
        try {
          if (this.rawRuntime?.observeVoiceAccounting?.(record)) return;
          const store = this.store();
          await store.owner.assertExecutor();
          await store.metadata.putVoiceAccounting(record);
        } catch (error) {
          this.voiceAccountingFailed = true;
          throw error;
        }
      },
    });
    try {
      if (context.response.mode === 'dictation') {
        return await DictationFlow.open(context, sink, signal, new NovaSttAdapter(voiceConfig, sockets, accounting), usage);
      }
      const runtime = this.voiceRuntime();
      if (!runtime?.executeTurn || !runtime.cancelLiveTurn || !runtime.reconcileSession
        || !runtime.getLiveTurnStatus || !runtime.findLiveSubmission || !runtime.getLiveDelivery) {
        throw new VoiceSessionError('VOICE_DISABLED');
      }
      const bridge = new AgentVoiceAdapter(runtime, (id, conversationId) =>
        this.voiceSessions.bindConversation(id, conversationId));
      const flow = await LiveFlow.open(context, sink, signal, {
        stt: new FluxSttAdapter(voiceConfig, sockets, accounting),
        tts: new FluxTtsAdapter(voiceConfig, sockets, accounting),
        hooks: bridge.hooks,
        activity: (c, busy) => this.voiceUsage.noteActivity(c.response.sessionId, busy),
        observe: (c, event) => this.voiceUsage.observe(c, event),
        usage,
      });
      bridge.attach(context, flow, sink);
      return flow;
    } catch (error) {
      if (error instanceof ProviderFault) this.voiceUsage.degrade();
      throw error;
    }
  }

  getHello(): string { return 'Hello from Aurvin'; }
  getHealth(): { status: string } { return { status: 'ok' }; }
}
