/**
 * ============================================================================
 * FILE: discovery.ts
 * LOCATION: backend/src/plugins/google-calendar/discovery.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manage Google Calendar discovery cache, pagination, and coalesced refreshes.
 *
 * ROLE IN PROJECT:
 *    Maintains bounded in-memory and persisted calendar discovery snapshots,
 *    coordinates single-flight refresh requests, enforces delivery limits,
 *    and ensures safe CAS rebasing without overwriting concurrent mutations.
 *
 * KEY COMPONENTS:
 *    - CalendarDiscoveryService: Core discovery coordinator service
 *    - DiscoveryRefreshInput: Parameters governing in-turn and out-of-turn discovery
 *    - refresh / ensureFresh: Coalesced discovery fetching with retention checks
 * ============================================================================
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CALENDAR_LIMITS, type CalendarLimits } from '../../contracts/calendar-policy.js';
import { z } from 'zod';
import {
  calendarDiscoverySnapshotSchema,
  calendarConnectionV2Schema,
  calendarListCalendarsResultSchema,
  type CalendarAccountBinding,
  type CalendarConnectionRecordV2,
  type CalendarConnectionStoreV2,
  type CalendarDiscoveryEntry,
  type CalendarDiscoveryPort,
  type CalendarDiscoverySnapshot,
} from '../../contracts/calendar-discovery.js';
import { calendarCursorV2PayloadSchema } from '../../contracts/calendar-compatibility.js';
import { calendarCalendarsResponseSchema } from '../../contracts/calendar-wire.js';
export type CalendarCalendarsResponse = z.infer<typeof calendarCalendarsResponseSchema>;
import type { CalendarAccountCredentialPort } from '../../contracts/calendar-connections.js';
import { jsonBytes } from '../../contracts/calendar-tools.js';
import { AppError } from '../../platform/errors/app-error.js';
import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';
import { toolFault } from './tools-validation.js';

export type DiscoveryRefreshInput = {
  account: CalendarAccountBinding;
  mode: 'in-turn' | 'out-of-turn';
  signal: AbortSignal;
  deadlineAt: string;
  force: boolean;
  purpose: 'discovery' | 'capability-recheck';
  consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
  consumeRefreshRequest: () => Promise<void>;
};

export type CalendarDiscoveryDependencies = {
  store: CalendarConnectionStoreV2;
  provider: CalendarDiscoveryPort;
  credentials: CalendarAccountCredentialPort;
  requireAccountCurrent: (account: CalendarAccountBinding, signal: AbortSignal) => Promise<CalendarConnectionRecordV2>;
  refreshAfterUnauthorized: (input: {
    account: CalendarAccountBinding;
    signal: AbortSignal;
    deadlineAt: string;
    consumeRefreshRequest: () => Promise<void>;
  }) => Promise<void>;
  rejectUnauthorizedAccount: (account: CalendarAccountBinding) => Promise<void>;
  retentionPolicy: () => { policyId: string; expiresAt: string } | null;
  limits: CalendarLimits;
  now?: () => number;
  diagnostic?: DiagnosticSink;
};

type DiscoveryFlight = {
  key: string;
  promise: Promise<CalendarDiscoverySnapshot>;
  controller: AbortController;
};

function isReconnectRequired(error: unknown): boolean {
  if (error && typeof error === 'object' && 'failure' in error) {
    const f = (error as { failure?: { code?: string } }).failure;
    return f?.code === 'RECONNECT_REQUIRED' || f?.code === 'CALENDAR_RECONNECT_REQUIRED';
  }
  return false;
}

export class CalendarDiscoveryService {
  private readonly deps: CalendarDiscoveryDependencies;
  private readonly flights = new Map<string, DiscoveryFlight>();
  // ponytail: process-local single-executor ceiling; upgrade to managed KMS key if multi-process or restart-surviving cursors are needed
  private readonly cursorKey = randomBytes(32);

  constructor(dependencies: CalendarDiscoveryDependencies) {
    this.deps = dependencies;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  invalidate(): void {
    for (const flight of this.flights.values()) {
      flight.controller.abort();
    }
    this.flights.clear();
  }

  async ensureFresh(input: DiscoveryRefreshInput): Promise<CalendarDiscoverySnapshot> {
    const current = await this.deps.requireAccountCurrent(input.account, input.signal);
    if (!input.force && current.discovery) {
      const nowMs = this.now();
      const expiresAt = Date.parse(current.discovery.expiresAt);
      const retentionExpiresAt = Date.parse(current.discovery.retentionExpiresAt);
      if (nowMs < expiresAt && nowMs < retentionExpiresAt) {
        diagnose(this.deps.diagnostic, {
          stage: 'cache', state: 'ok', origin: 'cache', delivery: 'not-sent',
        });
        return current.discovery;
      }
    }
    diagnose(this.deps.diagnostic, {
      stage: 'cache', state: 'start', origin: 'local', delivery: 'not-sent',
    });
    return this.refresh(input);
  }

  async refresh(input: DiscoveryRefreshInput): Promise<CalendarDiscoverySnapshot> {
    const account = input.account;
    const key = `${account.userId}:${account.connectionId}:${account.connectionRevision}:${input.mode}:${input.purpose}`;
    if (input.mode === 'out-of-turn') {
      const existing = this.flights.get(key);
      if (existing) {
        return this.awaitFlight(existing.promise, input.signal, input.deadlineAt);
      }
    }

    const leaderController = new AbortController();
    const promise = this.leadRefresh(input, leaderController);
    if (input.mode === 'out-of-turn') {
      this.flights.set(key, { key, promise, controller: leaderController });
    }
    try {
      return await this.awaitFlight(promise, input.signal, input.deadlineAt);
    } finally {
      if (input.mode === 'out-of-turn' && this.flights.get(key)?.promise === promise) {
        this.flights.delete(key);
      }
    }
  }

  async checkTarget(input: {
    account: CalendarAccountBinding;
    calendarId: string;
    signal: AbortSignal;
    deadlineAt: string;
    consumeRequest: (kind: 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<CalendarDiscoveryEntry | null> {
    if (!this.deps.provider.checkTarget) {
      const fresh = await this.refresh({
        account: input.account,
        mode: 'in-turn',
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        force: true,
        purpose: 'capability-recheck',
        consumeRequest: () => input.consumeRequest('capability-recheck'),
        consumeRefreshRequest: input.consumeRefreshRequest,
      });
      return fresh.entries.find((e) => e.calendarId === input.calendarId) ?? null;
    }

    const current = await this.deps.requireAccountCurrent(input.account, input.signal);
    const nowMs = this.now();
    if (input.signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (Date.parse(input.deadlineAt) <= nowMs) throw toolFault('budget', 'CALENDAR_DEADLINE_EXCEEDED');

    const limits = this.deps.limits ?? CALENDAR_LIMITS;
    const remaining = Date.parse(input.deadlineAt) - nowMs;
    const leaderController = new AbortController();
    const boundSignal = AbortSignal.any([
      input.signal,
      leaderController.signal,
      AbortSignal.timeout(Math.max(1, Math.min(limits.toolTimeoutMs, remaining))),
    ]);

    const cap = Math.min(limits.discoveryPagesInTurn, 2);
    let used = 0;
    const admit = async (_kind: 'discovery' | 'availability' | 'preflight' | 'capability-recheck') => {
      if (used >= cap) throw toolFault('budget', 'CALENDAR_REQUEST_BUDGET');
      used += 1;
      if (used > 1) {
        await this.deps.requireAccountCurrent(input.account, input.signal);
      }
      await input.consumeRequest('capability-recheck');
      await this.deps.requireAccountCurrent(input.account, input.signal);
    };

    const doCheck = async (): Promise<CalendarDiscoveryEntry | null> => {
      if (cap - used <= 0) throw toolFault('budget', 'CALENDAR_REQUEST_BUDGET');
      return this.deps.credentials.withAccessToken(
        {
          account: input.account,
          signal: boundSignal,
          deadlineAt: input.deadlineAt,
          consumeRefreshRequest: input.consumeRefreshRequest,
        },
        async (accessToken) =>
          this.deps.provider.checkTarget!({
            account: {
              userId: input.account.userId,
              connectionId: input.account.connectionId,
              connectionRevision: input.account.connectionRevision,
              googleSubjectId: input.account.googleSubjectId,
            },
            calendarId: input.calendarId,
            accessToken,
            grantedScopes: current.grantedScopes,
            policyAllows: true,
            signal: boundSignal,
            deadlineAt: input.deadlineAt,
            now: new Date(this.now()).toISOString(),
            retentionPolicy: this.deps.retentionPolicy(),
            consumeRequest: admit,
          }),
      );
    };

    let entry: CalendarDiscoveryEntry | null;
    try {
      entry = await doCheck();
    } catch (error) {
      if (isReconnectRequired(error) && cap - used > 0) {
        await this.deps.refreshAfterUnauthorized({
          account: input.account,
          signal: boundSignal,
          deadlineAt: input.deadlineAt,
          consumeRefreshRequest: input.consumeRefreshRequest,
        });
        try {
          entry = await doCheck();
        } catch (secondError) {
          if (isReconnectRequired(secondError)) {
            await this.deps.rejectUnauthorizedAccount(input.account);
          }
          throw secondError;
        }
      } else {
        throw error;
      }
    }

    const latest = await this.deps.requireAccountCurrent(input.account, input.signal);
    const old = latest.discovery;
    if (old) {
      const existing = old.entries.find((e) => e.calendarId === input.calendarId) ?? null;
      if (!isDeepStrictEqual(existing, entry)) {
        const nextEntries = entry === null
          ? old.entries.filter((e) => e.calendarId !== input.calendarId)
          : old.entries.some((e) => e.calendarId === input.calendarId)
            ? old.entries.map((e) => (e.calendarId === input.calendarId ? entry : e))
            : old.entries;
        const hasPrimary = nextEntries.some((e) => e.primary);
        const nextLimitations = hasPrimary
          ? old.limitations
          : Array.from(new Set([...old.limitations, 'primary-missing' as const]));
        const nextDiscovery = calendarDiscoverySnapshotSchema.safeParse({
          ...old,
          discoveryRevision: latest.revision + 1,
          entries: nextEntries,
          complete: old.complete && hasPrimary && nextLimitations.length === 0,
          limitations: nextLimitations,
        });
        if (nextDiscovery.success) {
          const next = calendarConnectionV2Schema.parse({
            ...latest,
            revision: latest.revision + 1,
            discovery: nextDiscovery.data,
            updatedAt: new Date(this.now()).toISOString(),
          });
          if (jsonBytes(next) <= 262144) {
            await this.deps.store.compareAndSwap({
              userId: latest.userId,
              expectedRevision: latest.revision,
              expectedConnectionRevision: latest.connectionRevision,
              expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
              next,
            });
          }
        }
      }
    }
    return entry;
  }

  private awaitFlight(
    promise: Promise<CalendarDiscoverySnapshot>,
    signal: AbortSignal,
    deadlineAt: string,
  ): Promise<CalendarDiscoverySnapshot> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value?: CalendarDiscoverySnapshot, error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        if (error !== undefined) reject(error);
        else resolve(value!);
      };
      const onAbort = () => finish(undefined, toolFault('cancelled', 'CALENDAR_CANCELLED'));
      const remaining = Date.parse(deadlineAt) - this.now();
      const timer = setTimeout(
        () => finish(undefined, new AppError('TIMEOUT', 'Calendar discovery timed out.', false)),
        Number.isFinite(remaining) ? Math.max(0, remaining) : 0,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (val) => finish(val),
        (err) => finish(undefined, err),
      );
    });
  }

  private async leadRefresh(
    input: DiscoveryRefreshInput,
    leaderController: AbortController,
  ): Promise<CalendarDiscoverySnapshot> {
    const current = await this.deps.requireAccountCurrent(input.account, input.signal);
    const nowMs = this.now();
    if (input.signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    if (Date.parse(input.deadlineAt) <= nowMs) throw toolFault('budget', 'CALENDAR_DEADLINE_EXCEEDED');

    const remaining = Date.parse(input.deadlineAt) - nowMs;
    const boundSignal = AbortSignal.any([
      input.signal,
      leaderController.signal,
      AbortSignal.timeout(Math.max(1, Math.min(CALENDAR_LIMITS.toolTimeoutMs, remaining))),
    ]);

    const limits = this.deps.limits ?? CALENDAR_LIMITS;
    const cap = Math.min(
      input.mode === 'in-turn' ? limits.discoveryPagesInTurn : limits.discoveryPagesOutOfTurn,
      input.mode === 'in-turn' ? 2 : 10,
    );
    let used = 0;
    const admit = async (_kind: 'discovery' | 'availability' | 'preflight' | 'capability-recheck') => {
      if (used >= cap) throw toolFault('budget', 'CALENDAR_REQUEST_BUDGET');
      used += 1;
      if (used > 1) {
        await this.deps.requireAccountCurrent(input.account, input.signal);
      }
      await input.consumeRequest(input.purpose);
      await this.deps.requireAccountCurrent(input.account, input.signal);
    };

    const baseRecordBytes = jsonBytes({
      ...current,
      revision: current.revision + 1,
      discovery: null,
    });
    const connectionSnapshotAllowance = 262144 - baseRecordBytes;
    if (connectionSnapshotAllowance <= 0) {
      throw toolFault('policy', 'CALENDAR_RESULT_TOO_LARGE');
    }

    const doDiscover = async (): Promise<CalendarDiscoverySnapshot> => {
      if (cap - used <= 0) throw toolFault('budget', 'CALENDAR_REQUEST_BUDGET');
      return this.deps.credentials.withAccessToken(
        {
          account: input.account,
          signal: boundSignal,
          deadlineAt: input.deadlineAt,
          consumeRefreshRequest: input.consumeRefreshRequest,
        },
        async (accessToken) => {
          const retention = this.deps.retentionPolicy();
          return this.deps.provider.discover({
            account: {
              userId: input.account.userId,
              connectionId: input.account.connectionId,
              connectionRevision: input.account.connectionRevision,
              googleSubjectId: input.account.googleSubjectId,
            },
            accessToken,
            grantedScopes: current.grantedScopes,
            policyAllows: true,
            signal: boundSignal,
            deadlineAt: input.deadlineAt,
            now: new Date(this.now()).toISOString(),
            retentionPolicy: retention,
            consumeRequest: admit,
            mode: input.mode,
            discoveryRevision: current.revision + 1,
            limits: {
              retainedCalendars: Math.min(100, limits.retainedCalendars),
              pageDeliveries: cap - used,
              snapshotBytes: Math.min(262144, limits.snapshotBytes, connectionSnapshotAllowance),
              freshnessMs: Math.min(300000, limits.discoveryFreshnessMs),
            },
          });
        },
      );
    };

    let fresh: CalendarDiscoverySnapshot;
    try {
      fresh = await doDiscover();
    } catch (error) {
      if (isReconnectRequired(error) && cap - used > 0) {
        await this.deps.refreshAfterUnauthorized({
          account: input.account,
          signal: boundSignal,
          deadlineAt: input.deadlineAt,
          consumeRefreshRequest: input.consumeRefreshRequest,
        });
        try {
          fresh = await doDiscover();
        } catch (secondError) {
          if (isReconnectRequired(secondError)) {
            await this.deps.rejectUnauthorizedAccount(input.account);
          }
          throw secondError;
        }
      } else {
        throw error;
      }
    }

    fresh = calendarDiscoverySnapshotSchema.parse(fresh);
    if (
      fresh.connectionId !== input.account.connectionId ||
      fresh.connectionRevision !== input.account.connectionRevision
    ) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }

    let latest = await this.deps.requireAccountCurrent(input.account, input.signal);
    if (latest.discovery?.complete && !fresh.complete) {
      return fresh;
    }

    const nowTimestamp = this.now();
    // Keep an unchanged complete snapshot's ORIGINAL bounded lifetime and revision.
    // Fresh provider rights were checked above; this does not extend cursor expiry
    // or cache changed/revoked capabilities. Avoid a no-op CAS as well.
    const old = latest.discovery;
    const unchanged = old?.complete && fresh.complete && Date.parse(old.expiresAt) > nowTimestamp
      && Date.parse(old.retentionExpiresAt) > nowTimestamp
      && old.retentionPolicyId === fresh.retentionPolicyId
      && Date.parse(fresh.retentionExpiresAt) >= Date.parse(old.expiresAt)
      && isDeepStrictEqual(old.entries, fresh.entries);
    if (
      Date.parse(fresh.expiresAt) <= nowTimestamp ||
      fresh.retentionPolicyId === null ||
      Date.parse(fresh.retentionExpiresAt) <= nowTimestamp
    ) {
      return fresh;
    }

    const discovery = unchanged ? { ...old, retentionExpiresAt:
      Date.parse(old.retentionExpiresAt) <= Date.parse(fresh.retentionExpiresAt)
        ? old.retentionExpiresAt : fresh.retentionExpiresAt }
      : { ...fresh, discoveryRevision: latest.revision + 1 };
    if (isDeepStrictEqual(discovery, old)) return discovery;
    let next = calendarConnectionV2Schema.parse({
      ...latest,
      revision: latest.revision + 1,
      discovery,
      updatedAt: new Date(nowTimestamp).toISOString(),
    });

    if (jsonBytes(next) > 262144) {
      throw toolFault('policy', 'CALENDAR_RESULT_TOO_LARGE');
    }

    let cas = await this.deps.store.compareAndSwap({
      userId: latest.userId,
      expectedRevision: latest.revision,
      expectedConnectionRevision: latest.connectionRevision,
      expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
      next,
    });

    if (cas.outcome === 'conflict') {
      latest = await this.deps.requireAccountCurrent(input.account, input.signal);
      if (
        latest.discovery &&
        (Date.parse(latest.discovery.fetchedAt) >= Date.parse(fresh.fetchedAt) ||
          latest.discovery.discoveryRevision >= fresh.discoveryRevision)
      ) {
        return latest.discovery;
      }
      const rebasedDiscovery = { ...fresh, discoveryRevision: latest.revision + 1 };
      next = calendarConnectionV2Schema.parse({
        ...latest,
        revision: latest.revision + 1,
        discovery: rebasedDiscovery,
        updatedAt: new Date(this.now()).toISOString(),
      });
      if (jsonBytes(next) > 262144) {
        throw toolFault('policy', 'CALENDAR_RESULT_TOO_LARGE');
      }
      cas = await this.deps.store.compareAndSwap({
        userId: latest.userId,
        expectedRevision: latest.revision,
        expectedConnectionRevision: latest.connectionRevision,
        expectedDefaultSettingRevision: latest.defaultSetting.defaultSettingRevision,
        next,
      });
    }

    if (cas.outcome === 'uncertain') {
      throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.', false);
    }
    if (cas.outcome !== 'confirmed') {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }

    return discovery;
  }

  page(input: {
    account: CalendarAccountBinding;
    discovery: CalendarDiscoverySnapshot;
    pageToken?: string;
  }): CalendarCalendarsResponse {
    const { account, discovery: snapshot, pageToken } = input;
    const nowTimestamp = this.now();
    const limits = this.deps.limits ?? CALENDAR_LIMITS;
    const pageSize = Math.min(20, limits.calendarsPerPage);

    const sha256 = (val: string): string => createHash('sha256').update(val, 'utf8').digest('hex');
    const accountHash = sha256(
      JSON.stringify({
        userId: account.userId,
        connectionId: account.connectionId,
        connectionRevision: account.connectionRevision,
        googleSubjectId: account.googleSubjectId,
      }),
    );
    const queryHash = sha256(
      JSON.stringify({
        kind: 'calendars',
        pageSize,
      }),
    );

    let offset = 0;
    if (pageToken !== undefined) {
      if (typeof pageToken !== 'string' || pageToken.length > 2048) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      const parts = pageToken.split('.');
      if (parts.length !== 2) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      const [encoded, signature] = parts;
      if (!signature || !/^[a-f0-9]{64}$/.test(signature)) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      const expectedSignature = createHmac('sha256', this.cursorKey).update(encoded, 'utf8').digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expectedSignature, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      let decodedPayload: unknown;
      try {
        decodedPayload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      } catch {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      const payload = calendarCursorV2PayloadSchema.parse(decodedPayload);
      if (
        payload.v !== 2 ||
        payload.kind !== 'calendars' ||
        payload.b !== accountHash ||
        payload.q !== queryHash ||
        payload.discoveryRevision !== snapshot.discoveryRevision ||
        Date.parse(payload.expiresAt) <= nowTimestamp ||
        payload.expiresAt !== snapshot.expiresAt
      ) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      const parsedOffset = Number.parseInt(payload.t, 10);
      if (
        !Number.isInteger(parsedOffset) ||
        parsedOffset < 0 ||
        parsedOffset >= snapshot.entries.length ||
        String(parsedOffset) !== payload.t
      ) {
        throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
      }
      offset = parsedOffset;
    }

    const isStale = nowTimestamp >= Date.parse(snapshot.expiresAt);
    const available = snapshot.entries.slice(offset);

    if (available.length === 0) {
      const limitations = isStale
        ? Array.from(new Set([...snapshot.limitations, 'stale' as const]))
        : [...snapshot.limitations];
      const page = calendarListCalendarsResultSchema.parse({
        schemaVersion: 2,
        tool: 'calendar_list_calendars',
        calendars: [],
        discoveryRevision: snapshot.discoveryRevision,
        fetchedAt: snapshot.fetchedAt,
        expiresAt: snapshot.expiresAt,
        complete: isStale ? false : snapshot.complete,
        truncated: snapshot.truncated,
        nextPageToken: null,
        limitations,
      });
      return calendarCalendarsResponseSchema.parse({ protocolVersion: 2, page });
    }

    let pageEntries = available.slice(0, pageSize);
    while (pageEntries.length > 0) {
      const nextOffset = offset + pageEntries.length;
      let nextPageToken: string | null = null;
      if (!isStale && nextOffset < snapshot.entries.length) {
        const payload = calendarCursorV2PayloadSchema.parse({
          v: 2,
          b: accountHash,
          q: queryHash,
          t: String(nextOffset),
          kind: 'calendars',
          discoveryRevision: snapshot.discoveryRevision,
          expiresAt: snapshot.expiresAt,
        });
        const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const signature = createHmac('sha256', this.cursorKey).update(encoded, 'utf8').digest('hex');
        nextPageToken = `${encoded}.${signature}`;
      }

      const limitations = isStale
        ? Array.from(new Set([...snapshot.limitations, 'stale' as const]))
        : [...snapshot.limitations];
      const truncated = isStale
        ? nextOffset < snapshot.entries.length || snapshot.truncated
        : snapshot.truncated;
      const complete = isStale ? false : snapshot.complete;

      const page = calendarListCalendarsResultSchema.parse({
        schemaVersion: 2,
        tool: 'calendar_list_calendars',
        calendars: pageEntries,
        discoveryRevision: snapshot.discoveryRevision,
        fetchedAt: snapshot.fetchedAt,
        expiresAt: snapshot.expiresAt,
        complete,
        truncated,
        nextPageToken,
        limitations,
      });

      const response = calendarCalendarsResponseSchema.parse({
        protocolVersion: 2,
        page,
      });

      const pageBytes = Buffer.byteLength(JSON.stringify(page), 'utf8');
      const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');

      if (pageBytes <= 15360 && responseBytes <= 16384) {
        return response;
      }

      pageEntries.pop();
    }

    throw toolFault('policy', 'CALENDAR_RESULT_TOO_LARGE');
  }
}
