/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/voice/usage/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public exports for the voice usage module.
 *
 * ROLE IN PROJECT:
 *    Exposes VoiceUsageService and related types to operations and runtime composition.
 *
 * KEY COMPONENTS:
 *    - VoiceUsageService
 *    - VoiceUsageSnapshot, VoiceUsagePorts, LatencySegment, VoiceStopReason, VoiceWarnCode
 * ============================================================================
 */

export { LATENCY_SEGMENTS, VoiceUsageService, percentile } from './voice-usage.service.js';
export type { LatencySegment, VoiceStopReason, VoiceUsagePorts, VoiceUsageSnapshot, VoiceWarnCode } from './voice-usage.service.js';
