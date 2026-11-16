/**
 * ============================================================================
 * FILE: skill-evidence.ts
 * LOCATION: backend/test/assembly/skill-evidence.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Project request bytes, conservative reservations, and unavailable usage.
 *
 * ROLE IN PROJECT:
 *    Test-only measurement projection for assembled skill evidence. It never
 *    estimates tokens, replaces production accounting, or invents provider data.
 *
 * KEY COMPONENTS:
 *    - BASELINE: Immutable recorded research observations for honest comparison.
 *    - requestEvidence: One serialized request's byte and reservation units.
 *    - taskEvidence: Per-task sums with null provider usage and latency.
 * ============================================================================
 */

import type { CapturedBody } from './skill-fixture.js';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const BASELINE = {
  sourceCommit: '86dd3974d5e000ab05f4d2285879a723fcd3f69f', applicationCommit: '118ba21',
  nativeToolsBytes: 2774,
  nativeToolsSha256: 'fbed2721e65f33b5a890d1bd77ee17fb2ccd5a5cae5e5f16b410db87d844f8f8',
  fixedPrefixBytes: 9680,
  fixedPrefixSha256: 'fffdb37fc8709f79cc2e87b8e29e9ba29a05ce1aac65558ed220fe3df0be14ea',
  coldBodies: [12884, 12886, 12919, 12892, 12894],
  coldReservationUnits: [12743, 12745, 12778, 12751, 12753],
  observedCorrectionRequests: 3, observedPaginationRequests: 3,
  matchedTaskLatencyMs: null,
} as const;
export function requestEvidence(body: CapturedBody) {
  return { bodyBytes: bytes(body), messageBytes: bytes(body.messages),
    toolsBytes: bytes(body.tools ?? []),
    reservationUnits: 64 + bytes({ messages: body.messages, tools: body.tools ?? [] })
      + 32 * body.messages.length };
}
export function taskEvidence(scenario: string, bodies: CapturedBody[], fixtureTaskMs: number) {
  const requests = bodies.map(requestEvidence);
  return { scenario, modelRequests: bodies.length, requests,
    bodyBytes: requests.reduce((n, r) => n + r.bodyBytes, 0),
    reservationUnits: requests.reduce((n, r) => n + r.reservationUnits, 0),
    fixtureTaskMs, providerLatencyMs: null,
    providerUsage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, uncachedInputTokens: null } };
}
