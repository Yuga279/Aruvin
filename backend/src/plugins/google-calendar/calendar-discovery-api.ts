/**
 * ============================================================================
 * FILE: calendar-discovery-api.ts
 * LOCATION: backend/src/plugins/google-calendar/calendar-discovery-api.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement Google Calendar discovery adapter (CalendarDiscoveryPort).
 *
 * ROLE IN PROJECT:
 *    Fetches, paginates, validates, and normalizes accessible Google CalendarList entries
 *    into frozen v2 discovery snapshots with honest limitations and capabilities.
 *
 * KEY COMPONENTS:
 *    - CalendarDiscoveryApi: Adapter implementing CalendarDiscoveryPort.
 *    - providerRecord / providerInvalid / providerDeadline / providerZone / providerCacheDeadline:
 *      Shared provider helpers exported for discovery and availability.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { calendarAccountBindingSchema, calendarDiscoveryEntrySchema, calendarDiscoverySnapshotSchema,
  calendarRoleSchema, effectiveCalendarCapabilities, type CalendarDiscoveryEntry,
  type CalendarDiscoveryPort, type CalendarProviderContext } from '../../contracts/calendar-discovery.js';
import { CALENDAR_LIMITS, calendarGrantStatus } from '../../contracts/calendar-policy.js';
import { jsonBytes } from '../../contracts/calendar-tools.js';
import type { DiagnosticSink } from '../../chat-runtime/ports.js';
import { calendarHttp } from './calendar-api-http.js';
import { CalendarToolFault, toolFault } from './tools-validation.js';

type DiscoveryInput = Parameters<CalendarDiscoveryPort['discover']>[0];
type Snapshot = Awaited<ReturnType<CalendarDiscoveryPort['discover']>>;

export const providerRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function providerInvalid(): never { throw toolFault('delivery', 'CALENDAR_RESPONSE_INVALID'); }

export function providerDeadline(input: CalendarProviderContext, now: number): string {
  if (!calendarAccountBindingSchema.safeParse(input.account).success
    || !Number.isFinite(Date.parse(input.now)) || !Number.isFinite(Date.parse(input.deadlineAt))
    || typeof input.accessToken !== 'string' || !input.accessToken
    || /[\u0000-\u001f\u007f]/u.test(input.accessToken)) {
    throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  }
  if (!input.policyAllows) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  if (calendarGrantStatus(input.grantedScopes).state !== 'complete') {
    throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
  }
  return new Date(Math.min(Date.parse(input.deadlineAt), now + CALENDAR_LIMITS.toolTimeoutMs)).toISOString();
}

export function providerZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; }
  catch { return false; }
}

export function providerCacheDeadline(headers: Headers, fetchedAt: string, ceiling: number): number {
  const at = Date.parse(fetchedAt);
  let end = ceiling;
  const directives = (headers.get('cache-control') ?? '').split(',').map(v => v.trim().toLowerCase());
  const age = Number(headers.get('age') ?? '0');
  if (!Number.isFinite(age) || age < 0) return at;
  if (directives.includes('must-revalidate') || directives.includes('no-transform')
    || (headers.get('pragma') ?? '').toLowerCase().includes('no-cache')) {
    return Math.max(at, end);
  }
  for (const directive of directives) {
    if (['no-store', 'no-cache'].includes(directive)) return at;
    if (directive.startsWith('max-age=')) {
      const value = directive.slice(8).replace(/^"|"$/gu, '');
      if (!/^\d+$/u.test(value)) return at;
      end = Math.min(end, at + Math.max(0, Number(value) - age) * 1000);
    }
  }
  const expires = headers.get('expires');
  if (expires !== null) {
    const parsed = Date.parse(expires);
    if (!Number.isFinite(parsed)) return at;
    end = Math.min(end, parsed);
  }
  return Math.max(at, end);
}

function projectEntry(raw: unknown, input: CalendarProviderContext): CalendarDiscoveryEntry | null {
  if (!providerRecord(raw)) return null;
  const role = calendarRoleSchema.safeParse(raw.accessRole);
  if (!role.success) return null;
  for (const key of ['primary', 'selected', 'hidden', 'deleted']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return null;
  }
  if (raw.timeZone !== undefined && !providerZone(raw.timeZone)) return null;
  const hidden = raw.hidden === true, deleted = raw.deleted === true;
  const parsed = calendarDiscoveryEntrySchema.safeParse({ calendarId: raw.id,
    label: raw.summaryOverride ?? raw.summary, primary: raw.primary === true,
    accessRole: role.data, privateAccess: role.data === 'owner' || role.data === 'writer',
    timeZone: raw.timeZone ?? null, selected: raw.selected === true, hidden, deleted,
    capabilities: effectiveCalendarCapabilities(role.data, input.grantedScopes,
      input.policyAllows && !hidden && !deleted) });
  if (!parsed.success || /[\u0000-\u001f\u007f]/u.test(parsed.data.calendarId)
    || ['.', '..'].includes(parsed.data.calendarId)) return null;
  return parsed.data;
}

export class CalendarDiscoveryApi implements CalendarDiscoveryPort {
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;
  private readonly diagnostic: DiagnosticSink | undefined;
  constructor(options: { fetcher?: typeof fetch; now?: () => number; diagnostic?: DiagnosticSink } = {}) {
    this.fetcher = options.fetcher ?? fetch; this.clock = options.now ?? Date.now;
    this.diagnostic = options.diagnostic;
  }

  async discover(input: DiscoveryInput): Promise<Snapshot> {
    const deadlineAt = providerDeadline(input, this.clock());
    const pageCap = Math.min(input.limits.pageDeliveries,
      input.mode === 'in-turn' ? CALENDAR_LIMITS.discoveryPagesInTurn : CALENDAR_LIMITS.discoveryPagesOutOfTurn);
    const countCap = Math.min(input.limits.retainedCalendars, CALENDAR_LIMITS.retainedCalendars);
    if (![pageCap, countCap, input.discoveryRevision, input.limits.snapshotBytes, input.limits.freshnessMs]
      .every(n => Number.isInteger(n) && n > 0)) throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');

    const entries = new Map<string, CalendarDiscoveryEntry>();
    const rejectedIds = new Set<string>();
    const seenEntries = new Map<string, string>();
    const limitations = new Set<Snapshot['limitations'][number]>();
    const seenTokens = new Set<string>();
    let primaryClaimantId: string | null = null;
    let token: string | null = null;
    const fetchedAt = new Date(this.clock()).toISOString();
    let expires = Math.min(Date.parse(fetchedAt) + Math.min(input.limits.freshnessMs, 300000),
      input.retentionPolicy ? Date.parse(input.retentionPolicy.expiresAt) : Date.parse(fetchedAt));
    if (!Number.isFinite(expires) || expires < Date.parse(fetchedAt)) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }

    const workingLimit = 262144;
    let rawBytesAlreadyIngested = 0;

    for (let page = 0; page < pageCap; page++) {
      const currentWork = rawBytesAlreadyIngested
        + jsonBytes([...entries.values()])
        + jsonBytes([...rejectedIds])
        + jsonBytes([...seenEntries]);
      const remainingWork = workingLimit - currentWork;
      if (remainingWork <= 0) {
        limitations.add('byte-limit');
        break;
      }

      const responseBytes = Math.min(262144, Math.max(1, remainingWork));
      const query = new URLSearchParams({ maxResults: '100', showDeleted: 'false', showHidden: 'false',
        fields: 'kind,nextPageToken,items(id,summary,summaryOverride,primary,accessRole,timeZone,selected,hidden,deleted)' });
      if (token !== null) query.set('pageToken', token);

      let response;
      try {
        response = await calendarHttp({ fetcher: this.fetcher, path: '/users/me/calendarList',
          method: 'GET', query, accessToken: input.accessToken, signal: input.signal, deadlineAt,
          consumeRequest: () => input.consumeRequest('discovery'), now: this.clock, responseBytes,
          responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
          diagnostic: this.diagnostic, requestKind: 'discovery' });
      } catch (error) {
        if (error instanceof CalendarToolFault && error.failure.code === 'CALENDAR_RESPONSE_TOO_LARGE') {
          limitations.add('byte-limit');
          break;
        }
        if (page > 0) {
          if (error instanceof CalendarToolFault) {
            if (['credential', 'policy', 'persistence', 'cancelled'].includes(error.failure.category)) {
              throw error;
            }
          }
          limitations.add('provider-error');
          break;
        }
        throw error;
      }

      rawBytesAlreadyIngested += response.bodyBytes;
      expires = providerCacheDeadline(response.headers, response.fetchedAt, expires);

      if (!providerRecord(response.body)) {
        if (page > 0) { limitations.add('provider-error'); break; }
        providerInvalid();
      }
      const items = response.body.items === undefined && response.body.kind === 'calendar#calendarList'
        ? [] : response.body.items;
      if (!Array.isArray(items) || items.length > 100) {
        if (page > 0) { limitations.add('provider-error'); break; }
        providerInvalid();
      }

      for (const item of items) {
        const entry = projectEntry(item, input);
        if (entry === null) {
          limitations.add('unsupported-entry');
          if (providerRecord(item) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 1024) {
            if (seenEntries.has(item.id)) {
              entries.delete(item.id);
              rejectedIds.add(item.id);
            }
          }
          continue;
        }

        if (rejectedIds.has(entry.calendarId)) continue;
        const fingerprint = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
        const previous = seenEntries.get(entry.calendarId);
        if (previous !== undefined && previous !== fingerprint) {
          entries.delete(entry.calendarId);
          rejectedIds.add(entry.calendarId);
          limitations.add('unsupported-entry');
          continue;
        }
        seenEntries.set(entry.calendarId, fingerprint);

        if (entry.primary) {
          if (primaryClaimantId === null) {
            primaryClaimantId = entry.calendarId;
          } else if (primaryClaimantId !== entry.calendarId) {
            entries.delete(primaryClaimantId);
            rejectedIds.add(primaryClaimantId);
            entries.delete(entry.calendarId);
            rejectedIds.add(entry.calendarId);
            limitations.add('unsupported-entry');
            continue;
          }
        }

        entries.set(entry.calendarId, entry);

        const priority = (a: CalendarDiscoveryEntry, b: CalendarDiscoveryEntry) =>
          Number(b.primary) - Number(a.primary)
          || (a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0);
        if (entries.size > countCap) {
          const ordered = [...entries.values()].sort(priority);
          entries.delete(ordered[ordered.length - 1]!.calendarId);
          limitations.add('calendar-limit');
        }
      }

      const next = response.body.nextPageToken;
      if (next !== undefined && (typeof next !== 'string' || next.length === 0 || next.length > 2048)) {
        if (page > 0) { limitations.add('provider-error'); break; }
        providerInvalid();
      }
      token = typeof next === 'string' ? next : null;
      if (token === null) break;
      if (seenTokens.has(token)) {
        limitations.add('provider-error');
        break;
      }
      seenTokens.add(token);
      if (entries.size >= countCap) { limitations.add('calendar-limit'); break; }
      if (page + 1 === pageCap) limitations.add('page-limit');
    }

    const priority = (a: CalendarDiscoveryEntry, b: CalendarDiscoveryEntry) =>
      Number(b.primary) - Number(a.primary)
      || (a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0);
    const retained = [...entries.values()].sort(priority).slice(0, countCap);
    if (entries.size > countCap) limitations.add('calendar-limit');
    if (!retained.some(e => e.primary)) limitations.add('primary-missing');

    const finalExpiresAt = new Date(Math.max(Date.parse(fetchedAt), Math.min(expires, Date.parse(fetchedAt) + 300000))).toISOString();
    const finalRetentionExpiresAt = input.retentionPolicy
      ? new Date(Math.min(Date.parse(input.retentionPolicy.expiresAt), Date.parse(finalExpiresAt))).toISOString()
      : fetchedAt;

    const maxBytes = Math.min(input.limits.snapshotBytes, 262144);
    const candidate: Snapshot = {
      schemaVersion: 2,
      connectionId: input.account.connectionId,
      connectionRevision: input.account.connectionRevision,
      discoveryRevision: input.discoveryRevision,
      entries: retained,
      fetchedAt,
      expiresAt: finalExpiresAt,
      complete: token === null && limitations.size === 0,
      truncated: ['calendar-limit', 'page-limit', 'byte-limit'].some(v => limitations.has(v as Snapshot['limitations'][number])),
      nextPageToken: token,
      limitations: [...limitations],
      retentionPolicyId: input.retentionPolicy?.policyId ?? null,
      retentionExpiresAt: finalRetentionExpiresAt,
    };

    if (jsonBytes(candidate) > maxBytes) {
      candidate.truncated = true;
      candidate.complete = false;
      limitations.add('byte-limit');
      candidate.limitations = [...limitations];

      while (jsonBytes(candidate) > maxBytes && candidate.entries.length > 0
        && !candidate.entries[candidate.entries.length - 1]!.primary) {
        candidate.entries.pop();
      }

      if (jsonBytes(candidate) > maxBytes && candidate.entries.length > 0 && candidate.entries[0]!.primary) {
        candidate.entries.pop();
        limitations.add('primary-missing');
        candidate.limitations = [...limitations];
      }

      if (jsonBytes(candidate) > maxBytes) {
        throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
      }
    }

    return calendarDiscoverySnapshotSchema.parse(candidate);
  }

  async checkTarget(input: CalendarProviderContext & { calendarId: string }): Promise<CalendarDiscoveryEntry | null> {
    const deadlineAt = providerDeadline(input, this.clock());
    if (typeof input.calendarId !== 'string' || input.calendarId.length === 0
      || input.calendarId.length > 1024 || input.calendarId === 'primary'
      || /[\u0000-\u001f\u007f]/u.test(input.calendarId) || ['.', '..'].includes(input.calendarId)) {
      throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
    }
    const query = new URLSearchParams({
      fields: 'id,summary,summaryOverride,primary,accessRole,timeZone,selected,hidden,deleted',
    });
    let response;
    try {
      response = await calendarHttp({
        fetcher: this.fetcher,
        path: `/users/me/calendarList/${encodeURIComponent(input.calendarId)}`,
        method: 'GET',
        query,
        accessToken: input.accessToken,
        signal: input.signal,
        deadlineAt,
        consumeRequest: () => input.consumeRequest('capability-recheck'),
        now: this.clock,
        responseBytes: 16384,
        responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
        diagnostic: this.diagnostic,
        requestKind: 'capability-recheck',
      });
    } catch (error) {
      if (error instanceof CalendarToolFault
        && (error.failure.code === 'EVENT_NOT_FOUND' || error.failure.code === 'EVENT_GONE')) {
        return null;
      }
      throw error;
    }
    const entry = projectEntry(response.body, input);
    if (!entry || entry.calendarId !== input.calendarId) {
      providerInvalid();
    }
    return entry;
  }
}
