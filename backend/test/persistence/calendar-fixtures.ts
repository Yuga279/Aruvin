import { connectionRecordSchema, oauthStateSchema } from '../../src/contracts/calendar-connections.js';
import { operationRecordSchema, operationEventSchema } from '../../src/contracts/calendar-operations.js';
import { sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import { turnBudgetRecordSchema, modelDispatchSchema } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
export const now = '2026-10-20T10:00:00.000Z';
export const later = '2026-10-20T10:03:00.000Z';
/**
 * The turn window is anchored to the current time because the accounting store
 * compares a dispatch reservation deadline with the wall clock: a pinned
 * instant is stale on any later date and every shared-fixture consumer fails.
 * The anchor resolves once per process so repeated reads of the fixture always
 * observe the same instants.
 */
const windowAnchorMs = Date.now();
export const turnWindowNow = new Date(windowAnchorMs).toISOString();
export const turnWindowStart = new Date(windowAnchorMs - 60_000).toISOString();
export const turnWindowDeadline = new Date(windowAnchorMs + 3_600_000).toISOString();
export const sha = 'a'.repeat(64);
export const secretEnvelope = { version: 1 as const, iv: Buffer.alloc(12).toString('base64'),
  tag: Buffer.alloc(16).toString('base64'), ciphertext: 'YQ==' };
export const source = () => sourceReferenceSchema.parse({ schemaVersion: 1, sourceId: 'src1',
  plugin: 'google-calendar', connectionId: 'c1', connectionRevision: 1, operationIds: ['op1'],
  fetchedAt: now, expiresAt: '2026-10-20T11:00:00.000Z', redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' } });
export const connection = () => connectionRecordSchema.parse({ schemaVersion: 1, userId: 'u1',
  provider: 'google-calendar', connectionId: 'c1', revision: 1, connectionRevision: 1,
  credentialVersion: 1, googleSubjectId: 'google-sub1', accountEmail: 'fixture@example.invalid',
  calendarId: 'fixture-owned-calendar', targetRevision: 1, enabled: true, status: 'connected',
  credentials: { access: secretEnvelope, refresh: secretEnvelope }, tokenExpiresAt: later,
  grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned'], updatedAt: now });
export const oauthState = () => oauthStateSchema.parse({ schemaVersion: 1,
  kind: 'calendar-oauth-state', userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64),
  oidcNonceHash: 'c'.repeat(64), encryptedVerifier: secretEnvelope,
  redirectUri: 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
  createdAt: now, expiresAt: '2026-10-20T10:10:00.000Z', consumedAt: null });
export const operation = () => operationRecordSchema.parse({ schemaVersion: 1,
  kind: 'calendar-operation', userId: 'u1', sessionId: 's1', turnId: 't1', operationId: 'op1',
  originatingAttemptId: 'a1', revision: 1, sequence: 1, connectionId: 'c1', connectionRevision: 1,
  googleSubjectId: 'google-sub1', calendarId: 'fixture-owned-calendar', targetRevision: 1,
  requestHash: sha, googleEventId: '0123456789abc', schemaRevision: 'google-calendar.v1',
  action: { summary: 'Fixture event', start: '2026-10-21T10:00:00Z',
    end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' }, actionSources: [],
  authorization: { acceptedUserMessageId: 'm0', canonicalActionHash: sha,
    approvedAt: now, basis: 'explicit-request' }, deliveryRetries: 0,
  createdAt: now, updatedAt: now, auditExpiresAt: '2026-11-19T10:00:00.000Z',
  state: 'planned', receipt: null, failure: null });
export const operationEvent = () => operationEventSchema.parse({ schemaVersion: 1,
  kind: 'calendar-operation-event', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  operationId: 'op1', eventId: 'oe1', sequence: 1, state: 'planned', createdAt: now, failure: null });
export const budget = () => turnBudgetRecordSchema.parse({ schemaVersion: 1,
  kind: 'calendar-turn-budget', userId: 'u1', sessionId: 's1', turnId: 't1', revision: 1,
  modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0, calendarRequests: 0,
  refreshRequests: 0, deadlineAt: turnWindowDeadline, createdAt: turnWindowStart,
  settledUsd: '0', reservedUsd: '0' });
export const dispatch = () => modelDispatchSchema.parse({ schemaVersion: 1,
  kind: 'calendar-model-dispatch', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  dispatchId: 'd1', decisionId: 'dec1', dispatchIndex: 1, reason: 'initial', repairedDecisionId: null,
  requestedModel: 'fixture/model', reportedModel: null, reportedProvider: null, openRouterUser: 'u1',
  configRevision: 1, connectionId: 'c1', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
  generationId: null, providerRequestId: null, status: 'reserved', startedAt: now,
  endedAt: null, firstOutputAt: null, promptTokens: null, completionTokens: null,
  cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
  money: unavailableMoney(true), pricing: { version: 'fixture-prices', source: 'fixture',
    observedAt: now, modelId: 'fixture/model', providerRoute: 'fixture-provider',
    promptUsdPerToken: '0.000001', completionUsdPerToken: '0.000002', requestUsd: '0' },
  reservationUsd: '0.25', reservationStatus: 'held', failure: null });
