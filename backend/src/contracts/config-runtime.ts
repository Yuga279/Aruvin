/**
 * ============================================================================
 * FILE: config-runtime.ts
 * LOCATION: backend/src/contracts/config-runtime.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define backend-only snapshot, credential, and activation configuration ports.
 *
 * ROLE IN PROJECT:
 *    Freezes the in-process runtime configuration contract so chat, voice, and
 *    assembly consume one detached snapshot instead of reassembling owners.
 *
 * KEY COMPONENTS:
 *    - VoiceConfig / RuntimeConfigSnapshot: Operation-stable runtime projection.
 *    - CurrentConfigPort / ConfigActivationPort: Pointer publication interfaces.
 *    - AdminConfigActor: Server-stamped identity and role assumption.
 * ============================================================================
 */

import type { BudgetConfig } from './budgets.js';
import type { ResolvedIdentity } from './identity.js';
import type { VoiceLimits } from './voice-wire.js';
import type { AdminRoleAssumption, ManageableSettings, SessionAdminRoleAssumption } from './admin-config-wire.js';
import type { StoredConfigDocument } from './admin-config.js';
import type { CalendarOptions } from './calendar-policy.js';
import type { CalendarTokenPricing } from './calendar-accounting.js';

export type DecryptedCredentials = { openrouter: string | null; deepgram: string | null };

export type VerifiedModelLimits = {
  modelId: string; contextTokens: number; outputTokens: number;
  supportsMaxTokens: boolean; source: 'fixture' | 'catalogue';
  calendar?: Readonly<{ tools: true; nativeStrict: boolean; parallelToolCallsParameter: boolean;
    pricing: CalendarTokenPricing }>;
};

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export type VoiceConfig = {
  enabledModes: { dictation: boolean; live: boolean }; limits: VoiceLimits;
  deepgram: { apiKey: string; apiBase: string; dictationModel: 'nova-3';
    liveModel: 'flux-general-en'; ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number };
  livekit?: LiveKitConfig | null;
  quotas: ManageableSettings['voice']['quotas']; rates: ManageableSettings['deepgram']['rates'];
};

export type RuntimeConfigSnapshot = {
  readonly schemaVersion: 1; readonly revision: number;
  readonly settings: Readonly<ManageableSettings>;
  readonly budgets: Readonly<BudgetConfig>;
  readonly openRouter: Readonly<{ apiKey: string; modelId: string;
    dataCollection: 'deny'; disableTransforms: true }>;
  readonly voice: Readonly<VoiceConfig & { dictationWarningMs: number | null }>;
  readonly modelLimits: Readonly<VerifiedModelLimits> | null;
  readonly calendar?: Readonly<CalendarOptions>;
};

export type SnapshotCandidate = {
  revision: number; settings: ManageableSettings; credentials: DecryptedCredentials;
};

export interface CurrentConfigPort { current(): RuntimeConfigSnapshot | null }

export interface ConfigActivationPort {
  prepare(candidate: SnapshotCandidate): Promise<RuntimeConfigSnapshot>;
  publish(snapshot: RuntimeConfigSnapshot): void;
}

export type SessionAdminConfigActor = {
  identity: ResolvedIdentity & { source: 'authenticated-session' };
  assumption: SessionAdminRoleAssumption;
};

export type AdminConfigActor = {
  identity: ResolvedIdentity; assumption: AdminRoleAssumption;
} | SessionAdminConfigActor;

export type ConfigCasResult =
  | { outcome: 'confirmed'; document: StoredConfigDocument }
  | { outcome: 'conflict'; currentRevision: number }
  | { outcome: 'uncertain' };

export interface ConfigRepository {
  read(): Promise<StoredConfigDocument | null>;
  createIfAbsent(document: StoredConfigDocument): Promise<ConfigCasResult>;
  compareAndSwap(expectedRevision: number, document: StoredConfigDocument): Promise<ConfigCasResult>;
}
