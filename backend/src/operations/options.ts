/**
 * ============================================================================
 * FILE: options.ts
 * LOCATION: backend/src/operations/options.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define structural P9 dependency options for operational controls.
 *
 * ROLE IN PROJECT:
 *    Lets P9 inject config, runtime, persistence, transport, and log ports
 *    without P8 constructing application entry points or extra executors.
 *
 * KEY COMPONENTS:
 *    - OperationsOptions: Existing typed dependencies consumed by operations.
 *    - stopVoice: Synchronous admission fence called before bounded drains.
 * ============================================================================
 */

import type { ChatRuntime } from '../chat-runtime/index.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import type { CurrentConfigPort } from '../contracts/config-runtime.js';
import type { ChatStreamTransport } from '../http/index.js';

export type OperationsOptions = {
  config: AurvinConfig;
  currentConfig?: CurrentConfigPort;
  runtime: () => ChatRuntime | null;
  assetsReady: () => boolean;
  modelLimitsReady: () => boolean;
  ping: () => Promise<boolean>;
  assertExecutor: () => Promise<void>;
  closePersistence: () => Promise<void>;
  transportSnapshot: () => ReturnType<ChatStreamTransport['snapshot']>;
  writeLog: (line: string) => void;
  authenticationReady?: () => boolean;
  now?: () => number;
  stopConfig?: () => void;
  stopVoice?: () => void;
  drainConfig?: (ms: number) => Promise<{ drained: boolean; unresolvedWrites: number }>;
  speechDegraded?: () => boolean;
  drainVoice?: (ms: number) => Promise<{ drained: boolean; active: number }>;
  stopCalendar?: () => void;
  drainCalendar?: (ms: number) => Promise<{
    drained: boolean; active: number; unresolvedWrites: number;
  }>;
  calendarSnapshot?: () => {
    state: 'disabled' | 'setup-required' | 'connected' | 'reconnect-required' | 'degraded';
    enabled: boolean;
  };
  voiceSnapshot?: () => {
    active: number; sessions: number; reconnects: number; failures: number; rejected: number;
    sttAudioMs: number; ttsAudioMs: number; ttsCharacters: number;
    audioComplete: boolean; charactersComplete: boolean;
    promptTokens: number | null; completionTokens: number | null;
    estimatedSpendUsd: number | null; spendStatus: 'known' | 'unknown';
    latency: Record<string, { count: number; p50: number | null; p95: number | null }>;
  };
};
