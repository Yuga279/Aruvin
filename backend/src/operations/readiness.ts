/**
 * ============================================================================
 * FILE: readiness.ts
 * LOCATION: backend/src/operations/readiness.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Separate liveness, read readiness, and generation admission gates.
 *
 * ROLE IN PROJECT:
 *    Caches one database/ownership probe and applies a passive provider
 *    cooldown without stopping the runtime or issuing paid health calls.
 *    Speech status includes requested LiveKit configuration in both branches.
 *
 * KEY COMPONENTS:
 *    - Readiness.read: Static reasons, cached DB probe, provider state, and speech health.
 *    - speechUnconfigured: Deepgram and requested-LiveKit configuration predicate.
 *    - providerFailure/providerSuccess: Admission-only circuit, not stopAccepting.
 * ============================================================================
 */

import type { AppErrorCode } from '../contracts/errors.js';
import { readinessIssues } from '../platform/config/load-config.js';
import { isLiveKitConfigured, type VoiceConfig } from '../platform/config/voice-config.js';
import type { OperationsOptions } from './options.js';
import { boundedResult } from './bounded.js';

function speechUnconfigured(voice: VoiceConfig): boolean {
  return !voice.deepgram.apiKey ||
    (voice.enabledModes.live && !isLiveKitConfigured(voice.livekit));
}

export class Readiness {
  private cache:{ at:number; db:boolean; executor:boolean } | null = null;
  private pending:Promise<{ db:boolean; executor:boolean }> | null = null;
  private providerUntil = 0;
  private providerBlocked = false;
  private providerHealthy = false;
  closing = false;
  constructor(private o:OperationsOptions) {}
  providerFailure(code:AppErrorCode) {
    if (code === 'PROVIDER_AUTH' || code === 'PROVIDER_CREDITS') this.providerBlocked = true;
    if (code === 'PROVIDER_ERROR' || code === 'TIMEOUT' || code === 'PROVIDER_AUTH' || code === 'PROVIDER_CREDITS') {
      this.providerHealthy = false; this.providerUntil = (this.o.now ?? Date.now)()+30000;
    }
  }
  providerSuccess() { if (!this.providerBlocked) { this.providerHealthy = true; this.providerUntil = 0; } }
  async readForRetry() {
    const status = await this.readForText();
    if (status.provider === 'degraded' && status.issues.length === 0) return { ...status, acceptReady: true as const };
    return status;
  }
  async readForText() {
    // A composed memory runtime exists only after startup storage/executor/assets
    // admission. Ordinary text uses bounded memory during later storage outages;
    // diagnostic readiness and durable paths retain the dependency probe.
    return this.read(Boolean(this.o.runtime()?.memoryAdmissionReady?.()));
  }
  private async dependencies() {
    const now = (this.o.now ?? Date.now)();
    if (this.cache && now-this.cache.at < 5000) return this.cache;
    if (!this.pending) {
      // Keep the same underlying promise until it settles: repeated health requests
      // cannot accumulate hung DB calls after a visible deadline expires.
      this.pending = (async () => {
        let db=false, executor=false;
        try { db = await this.o.ping(); if (db) { await this.o.assertExecutor(); executor=true; } } catch { /* safe flags only */ }
        const value = { db,executor }; this.cache = { at:(this.o.now ?? Date.now)(),...value }; return value;
      })();
      const tracked = this.pending;
      void tracked.finally(() => { if (this.pending === tracked) this.pending = null; });
    }
    const result = await boundedResult(this.pending,1000);
    return result.ok ? result.value : { db:false,executor:false };
  }
  async read(memoryText = false) {
    const issues:string[] = [];
    const port = this.o.currentConfig;
    if (port) {
      // Database-backed manageable checks come from the active snapshot;
      // infrastructure checks and deadlines stay on the static bootstrap adapter.
      const snapshot = port.current();
      if (!snapshot?.openRouter.apiKey) issues.push('OPENROUTER_API_KEY is missing');
      if (!snapshot?.openRouter.modelId) issues.push('OPENROUTER_MODEL is missing');
      if (!this.o.config.persistence.mongoUri) issues.push('unverified_persistence');
      if (!this.o.assetsReady()) issues.push('fixed_assets');
      if (!snapshot?.modelLimits) issues.push('model_limits');
      if (snapshot && (snapshot.openRouter.dataCollection !== 'deny' || !snapshot.openRouter.disableTransforms))
        issues.push('privacy_policy');
      const deps = memoryText ? { db: false, executor: true } : !this.o.config.persistence.mongoUri || issues.includes('unverified_persistence')
        ? { db:false,executor:false } : await this.dependencies();
      if (!deps.db && !memoryText) issues.push('database'); if (!deps.executor) issues.push('executor');
      const raw = this.o.runtime(); const state = raw?.snapshot();
      if (!raw) issues.push('runtime');
      if (state?.degraded) issues.push('runtime_quarantined');
      if (state && !state.accepting) issues.push('runtime_stopped');
      if (this.closing) issues.push('draining');
      if (this.o.authenticationReady && !this.o.authenticationReady()) issues.push('authentication');
      const provider = this.providerBlocked ? 'blocked' : (this.o.now ?? Date.now)() < this.providerUntil
        ? 'degraded' : this.providerHealthy ? 'healthy' : 'unknown';
      const voice = snapshot?.voice ?? null;
      const speechEnabled = Boolean(voice && (voice.enabledModes.dictation || voice.enabledModes.live));
      const speech = !speechEnabled || !voice ? 'off' as const
        : speechUnconfigured(voice) ? 'unconfigured' as const
        : this.o.speechDegraded?.() ? 'degraded' as const : 'ready' as const;
      return { live:true as const, readReady:deps.db && !issues.includes('authentication'),
        acceptReady:issues.length === 0 && provider !== 'blocked' && provider !== 'degraded', provider, speech, issues,
        ...(this.o.calendarSnapshot ? { calendar: this.o.calendarSnapshot() } : {}) };
    }
    if (readinessIssues(this.o.config).length) issues.push('configuration');
    if (!this.o.config.persistence.mongoUri) issues.push('unverified_persistence');
    if (!this.o.assetsReady()) issues.push('fixed_assets');
    if (!this.o.modelLimitsReady()) issues.push('model_limits');
    if (this.o.config.openRouter.dataCollection !== 'deny' || !this.o.config.openRouter.disableTransforms)
      issues.push('privacy_policy');
    const deps = memoryText ? { db: false, executor: true } : !this.o.config.persistence.mongoUri || issues.includes('unverified_persistence')
      ? { db:false,executor:false } : await this.dependencies();
    if (!deps.db && !memoryText) issues.push('database'); if (!deps.executor) issues.push('executor');
    const raw = this.o.runtime(); const state = raw?.snapshot();
    if (!raw) issues.push('runtime');
    if (state?.degraded) issues.push('runtime_quarantined');
    if (state && !state.accepting) issues.push('runtime_stopped');
    if (this.closing) issues.push('draining');
    if (this.o.authenticationReady && !this.o.authenticationReady()) issues.push('authentication');
    const provider = this.providerBlocked ? 'blocked' : (this.o.now ?? Date.now)() < this.providerUntil
      ? 'degraded' : this.providerHealthy ? 'healthy' : 'unknown';
    const voiceConfig = this.o.config.voice;
    const speechEnabled = Boolean(voiceConfig && (voiceConfig.enabledModes.dictation || voiceConfig.enabledModes.live));
    const speech = !speechEnabled || !voiceConfig ? 'off' as const
      : speechUnconfigured(voiceConfig) ? 'unconfigured' as const
      : this.o.speechDegraded?.() ? 'degraded' as const : 'ready' as const;
    return { live:true as const, readReady:deps.db && !issues.includes('authentication'),
      acceptReady:issues.length === 0 && provider !== 'blocked' && provider !== 'degraded', provider, speech, issues,
      ...(this.o.calendarSnapshot ? { calendar: this.o.calendarSnapshot() } : {}) };
  }
}
