/**
 * ============================================================================
 * FILE: calendar-assembly.ts
 * LOCATION: backend/src/operations/calendar-assembly.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose the Google Calendar plugin into the chat runtime dependency bundle.
 *
 * ROLE IN PROJECT:
 *    P8 owns this wiring. The assembled application must expose the Calendar v2
 *    dependency branch (capability gate, v2 execution, v2 model port) so the
 *    durable runtime advertises and runs the Calendar tools.
 *
 * KEY COMPONENTS:
 *    - createCalendarAssembly: Builds connections, OAuth, tools, execution, runtime.
 * ============================================================================
 */


import type { CalendarConnectionStore } from '../contracts/calendar-connections.js';
import type { CalendarConnectionStoreV2, CalendarDiscoveryPort }
  from '../contracts/calendar-discovery.js';
import type { CalendarCapabilityGate } from '../contracts/calendar-authority.js';
import type { CalendarRuntimeV2Dependencies } from '../chat-runtime/calendar-ports.js';
import type { SkillModelPort } from '../contracts/calendar-model.js';
import type { DiagnosticSink } from '../chat-runtime/ports.js';
import type { CalendarBootstrap } from '../platform/config/calendar-config.js';
import type { EncryptionBootstrap } from '../platform/config/bootstrap-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { CalendarSecretCipher } from '../platform/crypto/calendar-secret-cipher.js';
import { createCalendarModelPortV2 } from '../model/calendar-adapter.js';
import { CalendarApi } from '../plugins/google-calendar/calendar-api.js';
import { CalendarAvailabilityApi } from '../plugins/google-calendar/calendar-availability-api.js';
import { CalendarApiTools } from '../plugins/google-calendar/tools.js';
import { toolFault } from '../plugins/google-calendar/tools-validation.js';
import { GoogleCalendarConnections, type ConnectionDependencies }
  from '../plugins/google-calendar/connection.js';
import { GoogleCalendarOAuthClient } from '../plugins/google-calendar/oauth-client.js';
import { GoogleCalendarIdentity } from '../plugins/google-calendar/oauth-identity.js';
import { GoogleCalendarOAuthService } from '../plugins/google-calendar/oauth.js';

export function createCalendarAssembly(input: {
  config: CalendarBootstrap; encryption: EncryptionBootstrap;
  userId: string; store: CalendarConnectionStore;
  storeV2: CalendarConnectionStoreV2; discovery: CalendarDiscoveryPort;
  fetcher: typeof fetch;
  onAccountInvalidated: ConnectionDependencies['onAccountInvalidated'];
  diagnostic?: DiagnosticSink;
}) {
  const { setup, permission, policyDeadlines, trustedTimeZone } = input.config;
  const policyDeadline = policyDeadlines.length > 0 ? Math.min(...policyDeadlines) : null;
  const retentionPolicy: NonNullable<ConnectionDependencies['retentionPolicy']> = () => {
    if (!permission.minimalEvidenceAllowed || policyDeadline === null
      || policyDeadline <= Date.now()) return null;
    return { policyId: permission.policyId,
      expiresAt: new Date(Math.min(policyDeadline,
        Date.now() + setup.initial.limits.discoveryFreshnessMs)).toISOString() };
  };
  const cipher = new CalendarSecretCipher(input.encryption);
  const api = new CalendarApi({ fetcher: input.fetcher, diagnostic: input.diagnostic });
  const client = new GoogleCalendarOAuthClient({ options: setup, fetch: input.fetcher });
  const connections = new GoogleCalendarConnections({
    store: input.store, storeV2: input.storeV2, cipher, options: setup, userId: input.userId,
    client, target: api, discovery: input.discovery,
    onAccountInvalidated: input.onAccountInvalidated,
    retentionPolicy,
    diagnostic: input.diagnostic,
  });
  const oauth = new GoogleCalendarOAuthService({
    connections, store: input.store, cipher, options: setup, client,
    googleIdentity: new GoogleCalendarIdentity({ fetch: input.fetcher }),
  });
  // The configured processing policy deadline is a configuration gate: Calendar
  // work is refused while it is missing or expired, as the legacy gate did.
  const policyUnavailable = (): boolean => retentionPolicy() === null;
  const capabilities: CalendarCapabilityGate = {
    resolve: request => {
      if (policyUnavailable()) throw new AppError('NOT_READY', 'Calendar policy is unavailable.', false);
      return connections.capabilityGate.resolve(request);
    },
    requireCurrent: request => {
      if (policyUnavailable()) throw new AppError('NOT_READY', 'Calendar policy is unavailable.', false);
      return connections.capabilityGate.requireCurrent(request);
    },
  };
  const tools = new CalendarApiTools({
    api,
    gate: capabilities,
    credentials: connections,
    connections: input.storeV2,
    readDiscovery: async request => {
      if (policyUnavailable()) throw new AppError('NOT_READY', 'Calendar policy is unavailable.', false);
      const record = await connections.requireAccountCurrent(request.account, request.signal);
      const snapshot = connections.discoveryService
        ? await connections.discoveryService.ensureFresh({
            account: request.account, mode: 'in-turn', signal: request.signal,
            deadlineAt: request.deadlineAt, force: false, purpose: 'discovery',
            consumeRequest: request.consumeRequest, consumeRefreshRequest: request.consumeRefreshRequest,
          })
        : record.discovery;
      if (!snapshot) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      return { snapshot, grantedScopes: record.grantedScopes };
    },
    availability: new CalendarAvailabilityApi({ fetcher: input.fetcher, diagnostic: input.diagnostic }),
    limits: setup.initial.limits,
    permission,
    policyDeadlines,
    diagnostic: input.diagnostic,
  });
  const execution = tools;
  const createModelPort: CalendarRuntimeV2Dependencies['createModelPort'] = (config, limits, binding, fetcher, diagnostic) =>
    createCalendarModelPortV2(config, limits, binding, fetcher, diagnostic ?? input.diagnostic) as unknown as SkillModelPort;
  const runtime: CalendarRuntimeV2Dependencies = {
    connection: {
      currentAccount: () => connections.currentAccount(),
      requireAccountCurrent: (account, signal) => connections.requireAccountCurrent(account, signal),
    },
    capabilities,
    execution, createModelPort,
    trustedTimeZone, permission,
    ...(policyDeadline === null ? {} : { auditDeadlineAt: new Date(policyDeadline).toISOString() }),
  };
  return { connections, oauth, execution, runtime };
}
