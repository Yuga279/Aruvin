/**
 * ============================================================================
 * FILE: options.ts
 * LOCATION: backend/src/plugins/google-calendar/options.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse and validate Google Calendar plugin options and format public status.
 *
 * ROLE IN PROJECT:
 *    Sanitizes configuration options for loopback origins, client secrets, and
 *    OAuth parameters; projects safe public status payloads across v1 and v2.
 *
 * KEY COMPONENTS:
 *    - parseCalendarSetupOptions: Strict validation of setup options without pinned target
 *    - publicStatus: v1 backward-compatible status projection
 *    - publicStatusV2: v2 network-free status projection with discovery and scope status
 * ============================================================================
 */

import { z } from 'zod';
import {
  calendarOAuthOptionsV2Schema,
  loopbackRedirectSchema,
  type CalendarOAuthOptionsV2,
} from '../../contracts/calendar-connections.js';
import {
  calendarOptionsSchema,
  CALENDAR_SCOPES,
  calendarGrantSchema,
  calendarGrantStatus,
  type CalendarOptions,
} from '../../contracts/calendar-policy.js';
import {
  calendarStatusResponseSchema,
  calendarStatusV2ResponseSchema,
  type CalendarPublicStatus,
} from '../../contracts/calendar-wire.js';

export type CalendarStatusV2Response = z.infer<typeof calendarStatusV2ResponseSchema>;
import { primaryCalendarId } from '../../contracts/calendar-discovery.js';
import type { CalendarConnectionRecord } from '../../contracts/calendar-connections.js';
import type { CalendarConnectionRecordV2 } from '../../contracts/calendar-discovery.js';
import { AppError } from '../../platform/errors/app-error.js';

export const GOOGLE_OAUTH_ENDPOINTS = Object.freeze({
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  discovery: 'https://accounts.google.com/.well-known/openid-configuration',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
} as const);

export type CalendarOAuthOptions = CalendarOAuthOptionsV2;

export type CalendarSetupOptions = {
  initial: CalendarOptions;
  oauth: (CalendarOAuthOptions & { clientSecret: string }) | null;
  frontendOrigin: string;
  backendOrigin: string;
  evidence: 'google' | 'fixture';
  realDataPolicyApproved: boolean;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CONTROL = /[\u0000-\u001F\u007F]/;
const CLIENT_SECRET_MAX = 4096;
const DEFAULT_FRONTEND = 'http://127.0.0.1:5173';
const DEFAULT_BACKEND = 'http://127.0.0.1:3000';

function configError(): never {
  throw new AppError('CONFIGURATION_ERROR', 'Calendar setup configuration is invalid.', false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLoopbackOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) configError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    configError();
  }
  if (url.protocol !== 'http:') configError();
  if (!LOOPBACK_HOSTS.has(url.hostname)) configError();
  if (url.username || url.password) configError();
  if (url.search || url.hash) configError();
  if (url.pathname !== '/' && url.pathname !== '') configError();
  if (value !== url.origin) configError();
  return url.origin;
}

function parseClientSecret(value: unknown): string {
  if (typeof value !== 'string') configError();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 1 || bytes > CLIENT_SECRET_MAX || value.trim() !== value || CONTROL.test(value)) {
    configError();
  }
  return value;
}

function assertLegacyTarget(calendarId: string): void {
  if (CONTROL.test(calendarId)) configError();
  if (calendarId.split('/').some((segment) => segment === '.' || segment === '..')) configError();
}

function parseOauth(
  raw: unknown,
  frontendOrigin: string,
  backendOrigin: string,
): CalendarSetupOptions['oauth'] {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) configError();
  const secretPresent = typeof raw.clientSecret === 'string' && raw.clientSecret.length > 0;
  const clientIdPresent = typeof raw.clientId === 'string' && raw.clientId.length > 0;
  const redirectPresent = typeof raw.redirectUri === 'string' && raw.redirectUri.length > 0;
  const targetPresent = Object.prototype.hasOwnProperty.call(raw, 'targetCalendarId');
  if (!secretPresent && !clientIdPresent && !redirectPresent && !targetPresent) return null;
  if (!secretPresent) return null;
  const clientSecret = parseClientSecret(raw.clientSecret);
  const parsed = calendarOAuthOptionsV2Schema.safeParse({
    clientId: raw.clientId,
    redirectUri: raw.redirectUri,
    ...(raw.targetCalendarId === undefined ? {} : { targetCalendarId: raw.targetCalendarId }),
  });
  if (!parsed.success) configError();
  if (!loopbackRedirectSchema.safeParse(parsed.data.redirectUri).success) configError();
  if (parsed.data.targetCalendarId !== undefined) assertLegacyTarget(parsed.data.targetCalendarId);
  let redirect: URL;
  try {
    redirect = new URL(parsed.data.redirectUri);
  } catch {
    configError();
  }
  if (redirect.origin !== frontendOrigin && redirect.origin !== backendOrigin) configError();
  if (redirect.hostname !== new URL(frontendOrigin).hostname) configError();
  return { ...parsed.data, clientSecret };
}

export function parseCalendarSetupOptions(input: unknown): CalendarSetupOptions {
  const raw = isRecord(input) ? input : {};
  let initial: CalendarOptions;
  try {
    initial = calendarOptionsSchema.parse(raw.initial ?? {});
  } catch {
    configError();
  }
  const frontendOrigin = raw.frontendOrigin === undefined
    ? DEFAULT_FRONTEND
    : parseLoopbackOrigin(raw.frontendOrigin);
  const backendOrigin = raw.backendOrigin === undefined
    ? DEFAULT_BACKEND
    : parseLoopbackOrigin(raw.backendOrigin);
  const evidence = raw.evidence === undefined
    ? 'fixture'
    : raw.evidence === 'google' || raw.evidence === 'fixture'
      ? raw.evidence
      : configError();
  const realDataPolicyApproved = raw.realDataPolicyApproved === true;
  const oauth = parseOauth(raw.oauth, frontendOrigin, backendOrigin);
  return { initial, oauth, frontendOrigin, backendOrigin, evidence, realDataPolicyApproved };
}

export function publicStatus(input: {
  enabled: boolean; configured: boolean; degraded: boolean;
  record: CalendarConnectionRecord | CalendarConnectionRecordV2 | null;
  options: CalendarSetupOptions;
}): CalendarPublicStatus {
  const { enabled, configured, degraded, record, options } = input;
  const state = !enabled ? 'disabled' : !configured ? 'setup-required'
    : degraded ? 'degraded' : !record ? 'setup-required'
    : record.status === 'disconnected' ? 'setup-required'
    : record.status === 'reconnect-required' ? 'reconnect-required'
    : record.status === 'degraded' || options.evidence === 'fixture' ? 'degraded'
    : 'connected';

  let targetCalendarId: string | null = configured ? options.oauth?.targetCalendarId ?? null : null;
  if (record) {
    if (record.schemaVersion === 2) {
      targetCalendarId = record.defaultSetting?.defaultCalendarId
        ?? (record.discovery ? primaryCalendarId(record.discovery) : null)
        ?? (configured ? options.oauth?.targetCalendarId ?? null : null);
    } else {
      targetCalendarId = (record as CalendarConnectionRecord).calendarId
        ?? (configured ? options.oauth?.targetCalendarId ?? null : null);
    }
  }

  return calendarStatusResponseSchema.parse({
    protocolVersion: 1, state, enabled,
    accountEmail: record?.accountEmail ?? null,
    targetCalendarId,
    processingDisclosure: options.initial.processingPolicyId === null ? null : {
      policyId: options.initial.processingPolicyId,
      processors: 'Google, OpenRouter and the configured model provider',
      dataCollection: 'deny',
    },
  });
}

export function publicStatusV2(input: {
  enabled: boolean;
  configured: boolean;
  degraded: boolean;
  record: CalendarConnectionRecord | CalendarConnectionRecordV2 | null;
  options: CalendarSetupOptions;
  now?: number;
  partialGrantDiagnostic?: { lifecycleEpoch: number; missingScopes: readonly string[] } | null;
  lifecycleEpoch?: number;
}): CalendarStatusV2Response {
  const { enabled, configured, degraded, record, options } = input;
  const now = input.now ?? Date.now();
  const discovery = record?.schemaVersion === 2 ? record.discovery : null;
  const visible = discovery && now < Date.parse(discovery.retentionExpiresAt) ? discovery : null;
  const validGrant = record ? calendarGrantSchema.safeParse(record.grantedScopes).success : false;
  const hasDiagnostic = input.partialGrantDiagnostic && input.lifecycleEpoch !== undefined
    && input.partialGrantDiagnostic.lifecycleEpoch === input.lifecycleEpoch;
  const missingScopes = record && record.status !== 'disconnected'
    ? validGrant
      ? calendarGrantStatus(record.grantedScopes).missingScopes
      : CALENDAR_SCOPES.filter((s) => !record.grantedScopes.includes(s))
    : hasDiagnostic
      ? [...input.partialGrantDiagnostic!.missingScopes]
      : [];
  const state = !enabled
    ? 'disabled'
    : !configured
      ? 'setup-required'
      : degraded
        ? 'degraded'
        : !record
          ? hasDiagnostic
            ? 'reconnect-required'
            : 'setup-required'
          : record.status === 'disconnected'
            ? 'setup-required'
            : record.status === 'reconnect-required'
              ? 'reconnect-required'
              : record.schemaVersion === 1 || !validGrant || missingScopes.length > 0
                ? 'reconnect-required'
                : record.status === 'degraded' || options.evidence === 'fixture'
                  ? 'degraded'
                  : 'connected';

  const primary = visible ? primaryCalendarId(visible) : null;
  const defaultSetting = record?.schemaVersion === 2 ? record.defaultSetting : null;
  const processingDisclosure = options.initial.processingPolicyId === null ? null : {
    policyId: options.initial.processingPolicyId,
    processors: 'Google, OpenRouter and the configured model provider' as const,
    dataCollection: 'deny' as const,
  };

  return calendarStatusV2ResponseSchema.parse({
    protocolVersion: 2,
    state,
    enabled,
    accountEmail: record?.accountEmail ?? null,
    processingDisclosure,
    connectionRevision: record?.connectionRevision ?? null,
    defaultSetting,
    primaryCalendarId: primary,
    discovery: visible
      ? {
          discoveryRevision: visible.discoveryRevision,
          fetchedAt: visible.fetchedAt,
          expiresAt: visible.expiresAt,
          complete: visible.complete,
          truncated: visible.truncated,
          stale: now >= Date.parse(visible.expiresAt),
        }
      : null,
    missingScopes,
  });
}

export function backendAuthority(backendOrigin: string): string {
  return new URL(backendOrigin).host;
}
