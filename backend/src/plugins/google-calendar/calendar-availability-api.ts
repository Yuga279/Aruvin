/**
 * ============================================================================
 * FILE: calendar-availability-api.ts
 * LOCATION: backend/src/plugins/google-calendar/calendar-availability-api.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement Google Calendar availability adapter (CalendarAvailabilityPort).
 *
 * ROLE IN PROJECT:
 *    Queries Google Calendar freeBusy in bounded batches, computes honest coverage,
 *    coalesces busy intervals in UTC, and partitions full range into busy/free intervals.
 *
 * KEY COMPONENTS:
 *    - CalendarAvailabilityApi: Adapter implementing CalendarAvailabilityPort.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import type { CalendarAvailabilityPort } from '../../contracts/calendar-availability.js';
import { calendarAvailabilityBatchSchema, calendarAvailabilityResultSchema }
  from '../../contracts/calendar-availability.js';
import { calendarDiscoverySnapshotSchema, effectiveCalendarCapabilities }
  from '../../contracts/calendar-discovery.js';
import { jsonBytes } from '../../contracts/calendar-tools.js';
import { calendarHttp } from './calendar-api-http.js';
import { providerCacheDeadline, providerDeadline, providerInvalid, providerRecord, providerZone }
  from './calendar-discovery-api.js';
import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';
import { CalendarToolFault, parseCalendarTimestamp, toolFault } from './tools-validation.js';

type AvailabilityInput = Parameters<CalendarAvailabilityPort['check']>[0];
type Availability = Awaited<ReturnType<CalendarAvailabilityPort['check']>>;
type Interval = Availability['busy'][number];

const iso = (at: number) => new Date(at).toISOString();
const inputRejected = (diagnostic?: DiagnosticSink, fields: Readonly<Record<string, unknown>> = {}): never => {
  diagnose(diagnostic, {
    stage: 'validation', state: 'rejected', origin: 'local', delivery: 'not-sent',
    code: 'CALENDAR_INPUT_REJECTED', ...fields,
  });
  throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
};

function validateTimestamp(value: string, diagnostic?: DiagnosticSink, field: 'timeMin' | 'timeMax' = 'timeMin'): number {
  const facts = { reason: 'invalid-value', field, expected: 'string', constraint: 'rfc3339',
    suppliedType: typeof value === 'string' ? 'string' : 'unavailable',
    presence: value === undefined ? 'missing' : 'present' };
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) inputRejected(diagnostic, facts);
  const parsed = parseCalendarTimestamp(value);
  if (!parsed) return inputRejected(diagnostic, facts);
  if (parsed.fraction.length > 3 && !/^0+$/.test(parsed.fraction.slice(3))) {
    inputRejected(diagnostic, facts);
  }
  const utcDayCheck = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (utcDayCheck.getUTCFullYear() !== parsed.year || utcDayCheck.getUTCMonth() !== parsed.month - 1
    || utcDayCheck.getUTCDate() !== parsed.day) {
    inputRejected(diagnostic, facts);
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) inputRejected(diagnostic, facts);
  return at;
}

function parseBusyEndpoint(value: unknown, round: 'down' | 'up'): number | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) return null;
  const parsed = parseCalendarTimestamp(value);
  if (!parsed) return null;
  const utcDayCheck = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (utcDayCheck.getUTCFullYear() !== parsed.year || utcDayCheck.getUTCMonth() !== parsed.month - 1
    || utcDayCheck.getUTCDate() !== parsed.day) {
    return null;
  }
  let at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  if (parsed.fraction.length > 3 && !/^0+$/.test(parsed.fraction.slice(3))) {
    if (round === 'up') at += 1;
  }
  return at;
}

function coverageReason(reason: unknown): Availability['calendars'][number]['reason'] {
  switch (reason) {
    case 'notFound': return 'not-found';
    case 'forbidden': case 'insufficientPermissions': return 'forbidden';
    case 'rateLimitExceeded': case 'userRateLimitExceeded': return 'rate-limit';
    case 'quotaExceeded': return 'quota';
    case 'tooManyCalendarsRequested': case 'groupTooBig': return 'unsupported';
    default: return 'provider-error';
  }
}

function coalesce(intervals: Interval[], low: number, high: number): Interval[] {
  const sorted = intervals.map(v => ({ start: Math.max(low, Date.parse(v.start)),
    end: Math.min(high, Date.parse(v.end)) })).filter(v => v.end > v.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map(v => ({ start: iso(v.start), end: iso(v.end) }));
}

function complement(busy: Interval[], low: number, high: number): Interval[] {
  const free: Interval[] = [];
  let cursor = low;
  for (const interval of busy) {
    const start = Date.parse(interval.start), end = Date.parse(interval.end);
    if (start > cursor) free.push({ start: iso(cursor), end: iso(start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < high) free.push({ start: iso(cursor), end: iso(high) });
  return free;
}

export class CalendarAvailabilityApi implements CalendarAvailabilityPort {
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;
  private readonly diagnostic: DiagnosticSink | undefined;

  constructor(options: { fetcher?: typeof fetch; now?: () => number; diagnostic?: DiagnosticSink } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.clock = options.now ?? Date.now;
    this.diagnostic = options.diagnostic;
  }

  async check(input: AvailabilityInput): Promise<Availability> {
    if (!calendarDiscoverySnapshotSchema.safeParse(input.snapshot).success) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    if (input.snapshot.connectionId !== input.account.connectionId
      || input.snapshot.connectionRevision !== input.account.connectionRevision) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }

    const deadlineAt = providerDeadline(input, this.clock());
    const low = validateTimestamp(input.timeMin, this.diagnostic, 'timeMin');
    const high = validateTimestamp(input.timeMax, this.diagnostic, 'timeMax');
    if (high <= low) {
      inputRejected(this.diagnostic, { reason: 'invalid-value', field: 'timeMax', expected: 'string',
        constraint: 'time-order', suppliedType: 'string', presence: 'present' });
    }
    if ((high - low) > 31 * 86400000) {
      inputRejected(this.diagnostic, { reason: 'invalid-value', field: 'timeMax', expected: 'string',
        constraint: 'max-window', suppliedType: 'string', presence: 'present', limit: 31 });
    }
    if (!providerZone(input.timeZone)) {
      inputRejected(this.diagnostic, { reason: 'invalid-value', field: 'timeZone', expected: 'string',
        constraint: 'iana-zone', suppliedType: 'string', presence: 'present' });
    }

    if (![input.availabilityRevision, input.limits.batchCalendars, input.limits.batches,
      input.limits.busyIntervals, input.limits.workingBytes, input.limits.resultBytes]
      .every(n => Number.isInteger(n) && n > 0)) {
      inputRejected(this.diagnostic);
    }

    if (!Array.isArray(input.calendarIds) || input.calendarIds.length === 0 || input.calendarIds.length > 100) {
      inputRejected(this.diagnostic, { reason: 'out-of-range', field: 'calendarIds', expected: 'array',
        constraint: Array.isArray(input.calendarIds) && input.calendarIds.length === 0 ? 'min' : 'max',
        suppliedType: Array.isArray(input.calendarIds) ? 'array' : input.calendarIds == null ? 'missing' : typeof input.calendarIds,
        presence: 'present' });
    }
    if (new Set(input.calendarIds).size !== input.calendarIds.length) {
      inputRejected(this.diagnostic, { reason: 'invalid-value', field: 'calendarIds', expected: 'array',
        constraint: 'unique', suppliedType: 'array', presence: 'present' });
    }

    const snapshotMap = new Map(input.snapshot.entries.map(e => [e.calendarId, e]));
    for (const id of input.calendarIds) {
      if (id === 'primary' || !snapshotMap.has(id) || /[\u0000-\u001f\u007f]/u.test(id)
        || ['.', '..'].includes(id)) {
        inputRejected(this.diagnostic, { reason: 'invalid-value', field: 'calendarIds', expected: 'string',
          constraint: 'valid-id', suppliedType: 'string', presence: 'present' });
      }
    }

    const calendarSetHash = createHash('sha256')
      .update(JSON.stringify([...input.calendarIds].sort()), 'utf8').digest('hex');

    const checkedAt = new Date(this.clock()).toISOString();
    let expires = Math.min(Date.parse(checkedAt) + 300000,
      Date.parse(input.snapshot.expiresAt),
      input.retentionPolicy ? Date.parse(input.retentionPolicy.expiresAt) : Date.parse(checkedAt));

    const limitations = new Set<Availability['limitations'][number]>();
    let truncated = false;

    // Check if snapshot is stale
    const isStale = Date.parse(input.snapshot.expiresAt) <= Date.parse(input.now)
      || Date.parse(input.snapshot.expiresAt) <= this.clock();
    if (isStale) {
      limitations.add('discovery-stale');
      const calendars = input.calendarIds.map(id => ({
        calendarId: id,
        calendarLabel: snapshotMap.get(id)!.label,
        status: 'stale' as const,
        reason: 'stale' as const,
      }));
      return calendarAvailabilityResultSchema.parse({
        schemaVersion: 2,
        tool: 'calendar_check_availability',
        connectionId: input.account.connectionId,
        connectionRevision: input.account.connectionRevision,
        discoveryRevision: input.snapshot.discoveryRevision,
        availabilityRevision: input.availabilityRevision,
        calendarSetHash,
        timeMin: iso(low),
        timeMax: iso(high),
        timeZone: input.timeZone,
        checkedAt,
        expiresAt: new Date(expires).toISOString(),
        semantics: 'google-opaque-busy-only',
        calendars,
        busy: [],
        free: [],
        coverage: 'incomplete',
        conflict: 'unknown',
        truncated: false,
        limitations: [...limitations],
      });
    }

    if (!input.snapshot.complete || input.snapshot.truncated) {
      limitations.add('discovery-partial');
    }

    const calendarStatusMap = new Map<string, Availability['calendars'][number]>();
    for (const id of input.calendarIds) {
      const entry = snapshotMap.get(id)!;
      const effective = effectiveCalendarCapabilities(entry.accessRole, input.grantedScopes,
        input.policyAllows && !entry.hidden && !entry.deleted);
      if (entry.hidden || entry.deleted || !effective.availability) {
        calendarStatusMap.set(id, {
          calendarId: id,
          calendarLabel: entry.label,
          status: 'unsupported',
          reason: 'unsupported',
        });
        limitations.add('calendar-error');
      } else {
        calendarStatusMap.set(id, {
          calendarId: id,
          calendarLabel: entry.label,
          status: 'error',
          reason: 'missing-response',
        });
      }
    }

    const toQuery = input.calendarIds.filter(id => calendarStatusMap.get(id)!.status !== 'unsupported');
    const batchSize = Math.min(input.limits.batchCalendars, 50);
    const batchCap = Math.min(input.limits.batches, 2);
    const batches: string[][] = [];
    for (let i = 0; i < toQuery.length && batches.length < batchCap; i += batchSize) {
      batches.push(toQuery.slice(i, i + batchSize));
    }

    const maxQueried = batchCap * batchSize;
    if (toQuery.length > maxQueried) {
      for (let i = maxQueried; i < toQuery.length; i++) {
        const id = toQuery[i]!;
        calendarStatusMap.set(id, {
          calendarId: id,
          calendarLabel: snapshotMap.get(id)!.label,
          status: 'unsupported',
          reason: 'unsupported',
        });
      }
      limitations.add('calendar-limit');
      limitations.add('calendar-error');
      truncated = true;
    }

    const maxIntervals = Math.min(input.limits.busyIntervals, 2000);
    const workingCapacity = Math.min(input.limits.workingBytes, 262144);
    let rawBytesIngested = 0;
    let ingestedIntervals = 0;
    let busy: Interval[] = [];
    let stoppedEarly = false;

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      if (stoppedEarly) break;
      const batch = batches[bIndex]!;

      const currentUsed = rawBytesIngested
        + jsonBytes(busy)
        + jsonBytes([...calendarStatusMap.values()]);
      const remainingWork = workingCapacity - currentUsed;
      if (remainingWork <= 0) {
        limitations.add('byte-limit');
        truncated = true;
        for (const b of batches.slice(bIndex)) {
          for (const id of b) {
            if (calendarStatusMap.get(id)!.status === 'error' && calendarStatusMap.get(id)!.reason === 'missing-response') {
              calendarStatusMap.set(id, {
                calendarId: id,
                calendarLabel: snapshotMap.get(id)!.label,
                status: 'unsupported',
                reason: 'unsupported',
              });
            }
          }
        }
        break;
      }

      const responseBytes = Math.min(262144, Math.max(1, remainingWork));
      const query = new URLSearchParams({ fields: 'timeMin,timeMax,calendars' });
      calendarAvailabilityBatchSchema.parse({ calendarIds: batch });

      let response;
      try {
        response = await calendarHttp({
          fetcher: this.fetcher,
          path: '/freeBusy',
          method: 'POST',
          query,
          accessToken: input.accessToken,
          signal: input.signal,
          deadlineAt,
          now: this.clock,
          consumeRequest: () => input.consumeRequest(input.purpose),
          responseBytes,
          responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
          diagnostic: this.diagnostic,
          requestKind: input.purpose,
          body: {
            timeMin: input.timeMin,
            timeMax: input.timeMax,
            timeZone: input.timeZone,
            calendarExpansionMax: 50,
            items: batch.map(id => ({ id })),
          },
        });
      } catch (error) {
        if (error instanceof CalendarToolFault && error.failure.code === 'CALENDAR_RESPONSE_TOO_LARGE') {
          limitations.add('byte-limit');
          truncated = true;
          for (const b of batches.slice(bIndex)) {
            for (const id of b) {
              if (calendarStatusMap.get(id)!.status === 'error' && calendarStatusMap.get(id)!.reason === 'missing-response') {
                calendarStatusMap.set(id, {
                  calendarId: id,
                  calendarLabel: snapshotMap.get(id)!.label,
                  status: 'unsupported',
                  reason: 'unsupported',
                });
              }
            }
          }
          break;
        }
        if (bIndex > 0) {
          if (error instanceof CalendarToolFault) {
            if (['credential', 'policy', 'persistence', 'cancelled'].includes(error.failure.category)) {
              throw error;
            }
            let batchReason: Availability['calendars'][number]['reason'] = 'provider-error';
            if (error.failure.code === 'EVENT_NOT_FOUND') batchReason = 'not-found';
            else if (error.failure.code === 'CALENDAR_FORBIDDEN') batchReason = 'forbidden';
            else if (error.failure.code === 'CALENDAR_RATE_LIMITED') batchReason = 'rate-limit';
            else if (error.failure.code === 'CALENDAR_QUOTA_EXCEEDED') batchReason = 'quota';
            for (const id of batch) {
              calendarStatusMap.set(id, {
                calendarId: id,
                calendarLabel: snapshotMap.get(id)!.label,
                status: 'error',
                reason: batchReason,
              });
            }
            limitations.add('calendar-error');
            break;
          }
          for (const id of batch) {
            calendarStatusMap.set(id, {
              calendarId: id,
              calendarLabel: snapshotMap.get(id)!.label,
              status: 'error',
              reason: 'provider-error',
            });
          }
          limitations.add('calendar-error');
          break;
        }
        throw error;
      }

      rawBytesIngested += response.bodyBytes;
      expires = providerCacheDeadline(response.headers, response.fetchedAt, expires);

      if (!providerRecord(response.body) || !providerRecord(response.body.calendars)
        || typeof response.body.timeMin !== 'string' || typeof response.body.timeMax !== 'string'
        || Date.parse(response.body.timeMin) !== low || Date.parse(response.body.timeMax) !== high) {
        if (bIndex > 0) {
          for (const id of batch) {
            calendarStatusMap.set(id, {
              calendarId: id,
              calendarLabel: snapshotMap.get(id)!.label,
              status: 'error',
              reason: 'provider-error',
            });
          }
          limitations.add('calendar-error');
          break;
        }
        providerInvalid();
      }

      const returnedCals = response.body.calendars as Record<string, unknown>;
      for (let cIdx = 0; cIdx < batch.length; cIdx++) {
        const id = batch[cIdx]!;
        const calData = returnedCals[id];
        if (calData === undefined) {
          calendarStatusMap.set(id, {
            calendarId: id,
            calendarLabel: snapshotMap.get(id)!.label,
            status: 'error',
            reason: 'missing-response',
          });
          limitations.add('calendar-error');
          continue;
        }

        if (!providerRecord(calData)) {
          calendarStatusMap.set(id, {
            calendarId: id,
            calendarLabel: snapshotMap.get(id)!.label,
            status: 'error',
            reason: 'provider-error',
          });
          limitations.add('calendar-error');
          continue;
        }

        if (Array.isArray(calData.errors) && calData.errors.length > 0) {
          const rawReasons = calData.errors.slice(0, 10).map((err: unknown) =>
            providerRecord(err) && typeof err.reason === 'string' ? err.reason : undefined
          );
          const mappedReasons = rawReasons.map(r => coverageReason(r));
          let chosenReason: Availability['calendars'][number]['reason'] = 'provider-error';
          for (const priority of ['quota', 'forbidden', 'not-found', 'rate-limit', 'unsupported', 'provider-error'] as const) {
            if (mappedReasons.includes(priority)) {
              chosenReason = priority;
              break;
            }
          }
          calendarStatusMap.set(id, {
            calendarId: id,
            calendarLabel: snapshotMap.get(id)!.label,
            status: 'error',
            reason: chosenReason,
          });
          limitations.add('calendar-error');
          continue;
        }

        if (!Array.isArray(calData.busy)) {
          calendarStatusMap.set(id, {
            calendarId: id,
            calendarLabel: snapshotMap.get(id)!.label,
            status: 'error',
            reason: 'provider-error',
          });
          limitations.add('calendar-error');
          continue;
        }

        let calOk = true;
        const calBusy: Interval[] = [];
        for (const item of calData.busy) {
          ingestedIntervals++;
          if (ingestedIntervals > maxIntervals) {
            busy = coalesce([...busy, ...calBusy], low, high);
            limitations.add('interval-limit');
            truncated = true;
            stoppedEarly = true;
            calOk = false;
            // Mark remaining calendars in this and subsequent batches as unsupported
            for (let rem = cIdx; rem < batch.length; rem++) {
              const remId = batch[rem]!;
              calendarStatusMap.set(remId, {
                calendarId: remId,
                calendarLabel: snapshotMap.get(remId)!.label,
                status: 'unsupported',
                reason: 'unsupported',
              });
            }
            for (const remBatch of batches.slice(bIndex + 1)) {
              for (const remId of remBatch) {
                calendarStatusMap.set(remId, {
                  calendarId: remId,
                  calendarLabel: snapshotMap.get(remId)!.label,
                  status: 'unsupported',
                  reason: 'unsupported',
                });
              }
            }
            break;
          }

          if (!providerRecord(item)) {
            calOk = false;
            break;
          }
          const bStart = parseBusyEndpoint(item.start, 'down');
          const bEnd = parseBusyEndpoint(item.end, 'up');
          if (bStart === null || bEnd === null || bEnd <= bStart) {
            calOk = false;
            break;
          }
          if (bStart < high && bEnd > low) {
            calBusy.push({
              start: iso(Math.max(low, bStart)),
              end: iso(Math.min(high, bEnd)),
            });
          }
        }

        if (stoppedEarly) break;

        if (!calOk) {
          calendarStatusMap.set(id, {
            calendarId: id,
            calendarLabel: snapshotMap.get(id)!.label,
            status: 'error',
            reason: 'provider-error',
          });
          limitations.add('calendar-error');
          continue;
        }

        calendarStatusMap.set(id, {
          calendarId: id,
          calendarLabel: snapshotMap.get(id)!.label,
          status: 'ok',
          reason: null,
        });

        busy = coalesce([...busy, ...calBusy], low, high);
        const ledgerCheck = rawBytesIngested + jsonBytes(busy) + jsonBytes([...calendarStatusMap.values()]);
        if (ledgerCheck > workingCapacity) {
          limitations.add('byte-limit');
          truncated = true;
          stoppedEarly = true;
          for (let rem = cIdx + 1; rem < batch.length; rem++) {
            const remId = batch[rem]!;
            calendarStatusMap.set(remId, {
              calendarId: remId,
              calendarLabel: snapshotMap.get(remId)!.label,
              status: 'unsupported',
              reason: 'unsupported',
            });
          }
          for (const remBatch of batches.slice(bIndex + 1)) {
            for (const remId of remBatch) {
              calendarStatusMap.set(remId, {
                calendarId: remId,
                calendarLabel: snapshotMap.get(remId)!.label,
                status: 'unsupported',
                reason: 'unsupported',
              });
            }
          }
          break;
        }
      }
    }

    const calendars = input.calendarIds.map(id => calendarStatusMap.get(id)!);
    if (calendars.some(c => c.status === 'error' || c.status === 'unsupported')) {
      limitations.add('calendar-error');
    }

    const coalescedBusy = coalesce(busy, low, high);
    const complete = calendars.length > 0 && calendars.every(c => c.status === 'ok')
      && limitations.size === 0 && !truncated;
    const coverage = complete ? 'complete' : 'incomplete';
    const free = complete ? complement(coalescedBusy, low, high) : [];
    const conflict = coalescedBusy.length ? 'conflict' : complete ? 'clear' : 'unknown';

    const candidate: Availability = {
      schemaVersion: 2,
      tool: 'calendar_check_availability',
      connectionId: input.account.connectionId,
      connectionRevision: input.account.connectionRevision,
      discoveryRevision: input.snapshot.discoveryRevision,
      availabilityRevision: input.availabilityRevision,
      calendarSetHash,
      timeMin: iso(low),
      timeMax: iso(high),
      timeZone: input.timeZone,
      checkedAt,
      expiresAt: new Date(expires).toISOString(),
      semantics: 'google-opaque-busy-only',
      calendars,
      busy: coalescedBusy,
      free,
      coverage,
      conflict,
      truncated,
      limitations: [...limitations],
    };

    const resultLimit = Math.min(input.limits.resultBytes, 15360);
    if (jsonBytes(candidate) > resultLimit) {
      candidate.truncated = true;
      candidate.coverage = 'incomplete';
      candidate.free = [];
      candidate.limitations = [...new Set([...candidate.limitations, 'byte-limit' as const])];
      candidate.conflict = candidate.busy.length ? 'conflict' : 'unknown';
      while (jsonBytes(candidate) > resultLimit && candidate.busy.length > 1) {
        candidate.busy.pop();
      }
      while (jsonBytes(candidate) > resultLimit && candidate.calendars.length > 0) {
        candidate.calendars.pop();
      }
      if (jsonBytes(candidate) > resultLimit) {
        throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
      }
    }

    return calendarAvailabilityResultSchema.parse(candidate);
  }
}
