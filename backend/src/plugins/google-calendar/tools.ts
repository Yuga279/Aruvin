/**
 * ============================================================================
 * FILE: tools.ts
 * LOCATION: backend/src/plugins/google-calendar/tools.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Direct executor for Google Calendar tools with capability gating and account fencing.
 *
 * ROLE IN PROJECT:
 *    Composes port execution across list_events, get_event, create_event, list_calendars,
 *    and check_availability tools, enforcing single-process account/grant fences and
 *    target-bound provenance and receipts.
 *
 * KEY COMPONENTS:
 *    - CalendarApiTools: Execution port implementing CalendarExecutionPort and v2 overloads.
 *    - CalendarToolsDependencies / CalendarToolsV2Dependencies: Injected service interfaces.
 *    - effectAdmission: Single effect-admission seam with cheap store fencing.
 *    - buildSuccess / buildReceipt: Production envelope, v2 source and receipt builders.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CalendarCapabilityGate } from '../../contracts/calendar-authority.js';
import type { CalendarAvailabilityPort } from '../../contracts/calendar-availability.js';
import type {
  CalendarConnectionBinding, CalendarConnectionGate,
  CalendarCredentialPort, CalendarAccountCredentialPort,
} from '../../contracts/calendar-connections.js';
import {
  calendarConnectionV2Schema, type CalendarAccountBinding,
  type CalendarConnectionStoreV2, type CalendarDiscoverySnapshot,
  type CalendarResolvedTarget,
} from '../../contracts/calendar-discovery.js';
import {
  calendarExecutionBindingV2Schema, calendarExecutionEnvelopeV2Schema,
  calendarReceiptSchema, calendarReceiptV2Schema,
  type CalendarExecutionBinding, type CalendarExecutionBindingV2,
  type CalendarExecutionPort, type CalendarExecutionPortV2,
  type CalendarExecutionResult, type CalendarExecutionResultV2,
  type CalendarOperation, type CalendarOperationV2,
  type CalendarReceipt, type CalendarReceiptV2,
  type CalendarRequestKind, type CalendarRequestKindV2,
} from '../../contracts/calendar-operations.js';
import {
  calendarFailureSchema, calendarGrantStatus, calendarLimitsSchema,
  type CalendarFailure, type CalendarLimits,
} from '../../contracts/calendar-policy.js';
import {
  sourcePermissionSchema, sourceReferenceV2Schema, effectiveSourceExpiry,
  type CalendarSourceReference, type CalendarSourceReferenceV2,
} from '../../contracts/calendar-sources.js';
import {
  calendarResultSchema, calendarResultV2Schema, jsonBytes,
  type CalendarCall,
} from '../../contracts/calendar-tools.js';
import {
  CalendarApi, type CalendarHttpContext, type CalendarHttpContextV2,
  type CalendarReadResponse, type CalendarReadResponseV2,
} from './calendar-api.js';
import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';
import { CalendarCursor, type CalendarCursorScope } from './calendar-api-cursor.js';
import {
  CalendarToolFault, requireCreateAuthority, toolFault, validateCalendarCall,
} from './tools-validation.js';

const ENVELOPE_HEADROOM_BYTES = 1024;

export type DiscoveryRead = {
  account: CalendarAccountBinding;
  signal: AbortSignal;
  deadlineAt: string;
  consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
  consumeRefreshRequest: () => Promise<void>;
};

export type CalendarToolsV2Dependencies = {
  api: CalendarApi;
  gate: CalendarCapabilityGate;
  credentials: CalendarAccountCredentialPort;
  connections: Pick<CalendarConnectionStoreV2, 'get'>;
  readDiscovery(input: DiscoveryRead): Promise<{
    snapshot: CalendarDiscoverySnapshot; grantedScopes: readonly string[];
  }>;
  availability: CalendarAvailabilityPort;
  limits: CalendarLimits;
  permission: z.infer<typeof sourcePermissionSchema>;
  policyDeadlines: readonly number[];
  now?: () => number;
  cursorKey?: Uint8Array;
  diagnostic?: DiagnosticSink;
};

export type CalendarToolsDependencies = {
  api: CalendarApi;
  gate: CalendarConnectionGate;
  credentials: CalendarCredentialPort;
  limits: CalendarLimits;
  permission: z.infer<typeof sourcePermissionSchema>;
  policyDeadlines: readonly number[];
  now?: () => number;
  diagnostic?: DiagnosticSink;
};

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function toAccountBinding(binding: CalendarExecutionBindingV2): CalendarAccountBinding {
  return {
    userId: binding.userId,
    connectionId: binding.connectionId,
    connectionRevision: binding.connectionRevision,
    googleSubjectId: binding.googleSubjectId,
  };
}

function toFailure(error: unknown): CalendarFailure {
  if (error instanceof CalendarToolFault) return error.failure;
  return calendarFailureSchema.parse({ category: 'policy', code: 'CALENDAR_EXECUTION_DENIED', retry: 'none' });
}

type HeaderEvidence = { deadlines: number[]; forbidsRetention: boolean };

/**
 * Conservative `Cache-Control`/`Expires` reading. Absent or conflicting headers
 * never imply permission, and a zero or negative freshness is volatile.
 */
function headerEvidence(headers: Headers, fetchedAt: string): HeaderEvidence {
  const deadlines: number[] = [];
  let forbidsRetention = false;
  const cacheControl = headers.get('cache-control');
  const directives = cacheControl === null
    ? []
    : cacheControl.split(',').map((directive) => directive.trim().toLowerCase());
  if (directives.includes('must-revalidate') || directives.includes('no-transform')
    || (headers.get('pragma') ?? '').toLowerCase().includes('no-cache')) {
    return { deadlines, forbidsRetention };
  }
  if (cacheControl !== null) {
    if (directives.some((directive) => directive === 'no-store' || directive === 'no-cache')) {
      forbidsRetention = true;
    } else {
      const maxAge = directives.find((directive) => directive.startsWith('max-age='));
      if (maxAge !== undefined) {
        const seconds = Number(maxAge.slice('max-age='.length));
        if (!Number.isFinite(seconds) || seconds < 0) forbidsRetention = true;
        else {
          const age = Number(headers.get('age') ?? '0');
          const effective = Number.isFinite(age) && age > 0 ? Math.max(0, seconds - age) : seconds;
          if (effective <= 0) forbidsRetention = true;
          else deadlines.push(Date.parse(fetchedAt) + effective * 1000);
        }
      }
    }
  }
  const expires = headers.get('expires');
  if (expires !== null) {
    const at = Date.parse(expires);
    if (!Number.isFinite(at)) forbidsRetention = true;
    else deadlines.push(at);
  }
  return { deadlines, forbidsRetention };
}

export class CalendarApiTools implements CalendarExecutionPort, CalendarExecutionPortV2 {
  private readonly v1Deps?: CalendarToolsDependencies;
  private readonly v2Deps?: CalendarToolsV2Dependencies;
  private readonly limits: CalendarLimits;
  private readonly permission: z.infer<typeof sourcePermissionSchema>;
  private readonly policyDeadlines: readonly number[];
  private readonly clock: () => number;
  private readonly cursor: CalendarCursor;
  private readonly diagnostic: DiagnosticSink | undefined;
  private readonly closing = new AbortController();
  private closed = false;
  private readonly pending = new Set<Promise<void>>();
  private closePromise: Promise<void> | null = null;
  get activeExecutions(): number { return this.pending.size; }
  private track<T>(work: () => Promise<T>): Promise<T> {
    let settle!: () => void;
    const done = new Promise<void>(resolve => { settle = resolve; });
    this.pending.add(done);
    return (async () => {
      try { return await work(); }
      finally { this.pending.delete(done); settle(); }
    })();
  }

  constructor(dependencies: CalendarToolsDependencies | CalendarToolsV2Dependencies) {
    if ('readDiscovery' in dependencies) {
      this.v2Deps = dependencies;
      this.limits = calendarLimitsSchema.parse(dependencies.limits);
      this.permission = sourcePermissionSchema.parse(dependencies.permission);
      this.policyDeadlines = [...dependencies.policyDeadlines];
      this.clock = dependencies.now ?? (() => Date.now());
      this.diagnostic = dependencies.diagnostic;
      this.cursor = new CalendarCursor(dependencies.cursorKey, this.clock, this.diagnostic);
    } else {
      this.v1Deps = dependencies;
      this.limits = calendarLimitsSchema.parse(dependencies.limits);
      this.permission = sourcePermissionSchema.parse(dependencies.permission);
      this.policyDeadlines = [...dependencies.policyDeadlines];
      this.clock = dependencies.now ?? (() => Date.now());
      this.diagnostic = dependencies.diagnostic;
      this.cursor = new CalendarCursor(undefined, this.clock, this.diagnostic);
    }
    if (!this.policyDeadlines.every(Number.isFinite)) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
  }

  async invoke(input: {
    binding: CalendarExecutionBindingV2;
    call: CalendarCall;
    signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<CalendarExecutionResultV2>;
  async invoke(input: {
    binding: CalendarExecutionBinding;
    call: CalendarCall;
    signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<CalendarExecutionResult>;
  async invoke(input: {
    binding: CalendarExecutionBinding | CalendarExecutionBindingV2;
    call: CalendarCall;
    signal: AbortSignal;
    consumeRequest: (kind: any) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<CalendarExecutionResult | CalendarExecutionResultV2> {
    if (this.closed) return { outcome: 'failure', failure: toFailure(toolFault('policy', 'CALENDAR_EXECUTION_DENIED')) };
    const startedAt = performance.now();
    const scope = { tool: input.call?.name, sessionId: input.binding?.sessionId,
      turnId: input.binding?.turnId, attemptId: input.binding?.attemptId,
      toolCallId: input.binding?.toolCallId, decisionId: input.binding?.decisionId };
    diagnose(this.diagnostic, { ...scope, stage: 'tool-execution', state: 'start' });
    try {
    const result = await this.track<CalendarExecutionResult | CalendarExecutionResultV2>(async () => {
    if (input.binding.schemaRevision === 'google-calendar.v1') {
      return { outcome: 'failure', failure: toFailure(toolFault('policy', 'CALENDAR_EXECUTION_DENIED')) };
    }

    const parsedBinding = calendarExecutionBindingV2Schema.safeParse(input.binding);
    if (!parsedBinding.success) {
      if (input.call?.name === 'calendar_create_event') {
        return { outcome: 'failure', failure: toFailure(toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED')) };
      }
      return { outcome: 'failure', failure: toFailure(toolFault('policy', 'CALENDAR_EXECUTION_DENIED')) };
    }
    const binding = parsedBinding.data;

    try {
      const call = validateCalendarCall(input.call, this.limits, this.diagnostic);

      const deadlineAt = Date.parse(binding.deadlineAt);
      if (!Number.isFinite(deadlineAt)) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      const remaining = deadlineAt - this.clock();
      if (remaining <= 0) throw toolFault('budget', 'CALENDAR_DEADLINE_EXCEEDED');
      const timeoutMs = Math.min(this.limits.toolTimeoutMs, remaining);
      const signal = AbortSignal.any([input.signal, this.closing.signal, AbortSignal.timeout(timeoutMs)]);

      const requireAccount = async (): Promise<void> => {
        signal.throwIfAborted();
        const rawRecord = await this.v2Deps!.connections.get(binding.userId);
        if (!rawRecord) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
        const record = calendarConnectionV2Schema.parse(rawRecord);
        if (!record.enabled || record.status !== 'connected') {
          throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
        }
        if (record.connectionId !== binding.connectionId
          || record.connectionRevision !== binding.connectionRevision
          || record.googleSubjectId !== binding.googleSubjectId) {
          throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
        }
        if (calendarGrantStatus(record.grantedScopes).state !== 'complete') {
          throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
        }
      };

      const admit = async (kind: CalendarRequestKindV2): Promise<void> => {
        signal.throwIfAborted();
        await requireAccount();
        await input.consumeRequest(kind);
        signal.throwIfAborted();
        await requireAccount();
        signal.throwIfAborted();
      };

      await requireAccount();

      switch (call.name) {
        case 'calendar_get_event':
        case 'calendar_list_events': {
          let target: CalendarResolvedTarget;
          if (binding.target !== null) {
            if (call.arguments.calendarId !== undefined && call.arguments.calendarId !== binding.target.calendarId) {
              throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
            }
            await this.v2Deps!.gate.requireCurrent({
              target: binding.target,
              operation: 'read',
              deadlineAt: binding.deadlineAt,
              consumeRequest: () => admit('capability-recheck'),
              consumeRefreshRequest: input.consumeRefreshRequest,
              signal,
            });
            target = binding.target;
          } else {
            const res = await this.v2Deps!.gate.resolve({
              account: toAccountBinding(binding),
              selector: call.arguments.calendarId ?? null,
              operation: 'read',
              deadlineAt: binding.deadlineAt,
              consumeRequest: () => admit('discovery'),
              consumeRefreshRequest: input.consumeRefreshRequest,
              signal,
            });
            if (res.outcome === 'clarify') throw toolFault('clarification', res.code);
            if (res.outcome === 'denied') throw toolFault('policy', res.code);
            target = res.target;
          }

          const response = await this.v2Deps!.credentials.withAccessToken({
            account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
            consumeRefreshRequest: input.consumeRefreshRequest,
          }, async (accessToken) => {
            const context: CalendarHttpContextV2 = {
              binding, target, accessToken, signal, deadlineAt: binding.deadlineAt,
              consumeRequest: admit,
            };
            if (call.name === 'calendar_list_events') return this.v2Deps!.api.list(context, call.arguments);
            return this.v2Deps!.api.get(context, call.arguments);
          });
          return this.buildSuccessV2(binding, call, target, null, response);
        }

        case 'calendar_create_event': {
          if (!binding.target) throw toolFault('policy', 'OPERATION_AUTHORITY_REQUIRED');
          if (!this.permission.minimalEvidenceAllowed) {
            throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
          }
          const operation = requireCreateAuthority(binding, call.arguments, this.clock());
          await this.v2Deps!.gate.requireCurrent({
            target: binding.target,
            operation: 'create',
            deadlineAt: binding.deadlineAt,
            consumeRequest: () => admit('capability-recheck'),
            consumeRefreshRequest: input.consumeRefreshRequest,
            signal,
          });

          const response = await this.v2Deps!.credentials.withAccessToken({
            account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
            consumeRefreshRequest: input.consumeRefreshRequest,
          }, async (accessToken) => {
            const context: CalendarHttpContextV2 = {
              binding, target: binding.target!, accessToken, signal, deadlineAt: binding.deadlineAt,
              consumeRequest: admit,
            };
            try {
              return await this.v2Deps!.api.create(context, operation);
            } catch (error) {
              if (error instanceof CalendarToolFault
                && error.failure.code === 'CALENDAR_RESPONSE_FIELDS_INVALID') {
                // One bounded GET, never a second POST or a model request.
                const readback = await this.v2Deps!.api.readback(context, operation);
                if (readback.outcome === 'matched') return readback.response;
              }
              if (error instanceof CalendarToolFault) throw error;
              throw toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
            }
          });
          return this.buildSuccessV2(binding, call, binding.target, operation, response);
        }

        case 'calendar_list_calendars': {
          const discovery = await this.v2Deps!.readDiscovery({
            account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
            consumeRequest: admit, consumeRefreshRequest: input.consumeRefreshRequest,
          });
          const snapshot = discovery.snapshot;
          diagnose(this.diagnostic, {
            stage: 'tool-execution', tool: 'calendar_list_calendars', origin: 'cache', delivery: 'not-sent',
          });
          const pageSize = Math.min(this.limits.calendarsPerPage, 20);
          const sHash = sha256(JSON.stringify(snapshot.entries.map(e => e.calendarId).sort()));
          const cursorScope: CalendarCursorScope = {
            kind: 'calendars',
            discoveryRevision: snapshot.discoveryRevision,
            expiresAt: snapshot.expiresAt,
          };
          let offset = 0;
          if (call.arguments.pageToken !== undefined) {
            try {
              const decoded = this.cursor.decode(call.arguments.pageToken, binding, { snapshotHash: sHash, pageSize }, cursorScope);
              offset = Number(decoded);
              if (!Number.isInteger(offset) || offset < 0 || offset > snapshot.entries.length) {
                diagnose(this.diagnostic, {
                  stage: 'cursor', state: 'rejected', reason: 'cursor-scope', field: 'pageToken',
                  expected: 'valid-cursor', suppliedType: 'string', presence: 'present',
                  origin: 'local', delivery: 'not-sent', code: 'CALENDAR_INPUT_REJECTED',
                });
                throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
              }
            } catch {
              throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
            }
          }

          let pageEntries = snapshot.entries.slice(offset, offset + pageSize);
          let truncated = false;
          let nextOffset = offset + pageEntries.length;

          const buildPageResult = (entries: typeof pageEntries, nextTok: string | null, isTruncated: boolean) => {
            const calendars = entries.map(e => ({
              calendarId: e.calendarId,
              label: e.label,
              primary: e.primary,
              accessRole: e.accessRole,
              privateAccess: e.privateAccess,
              timeZone: e.timeZone,
              selected: e.selected,
              hidden: e.hidden,
              deleted: e.deleted,
              capabilities: e.capabilities,
            }));
            const limitations: Array<"page-limit" | "calendar-limit" | "byte-limit" | "provider-error" | "unsupported-entry" | "primary-missing" | "stale"> = isTruncated
              ? Array.from(new Set([...snapshot.limitations, 'byte-limit' as const]))
              : [...snapshot.limitations];
            return {
              schemaVersion: 2 as const,
              tool: 'calendar_list_calendars' as const,
              calendars,
              discoveryRevision: snapshot.discoveryRevision,
              fetchedAt: snapshot.fetchedAt,
              expiresAt: snapshot.expiresAt,
              nextPageToken: nextTok,
              complete: snapshot.complete && !isTruncated && limitations.length === 0,
              truncated: snapshot.truncated || isTruncated,
              limitations,
            };
          };

          let nextCursor = nextOffset < snapshot.entries.length
            ? this.cursor.encode(String(nextOffset), binding, { snapshotHash: sHash, pageSize }, cursorScope)
            : null;

          let result = buildPageResult(pageEntries, nextCursor, false);
          let sourceTargets = pageEntries.map(e => ({ calendarId: e.calendarId, calendarLabel: e.label }));
          let source = this.buildSourceV2(
            binding, sourceTargets, [], [binding.toolCallId],
            new Date(this.clock()).toISOString(), new Headers(), snapshot.discoveryRevision,
          );

          while (pageEntries.length > 0) {
            const envelopeCandidate = { outcome: 'success' as const, result, source, receipt: null };
            if (jsonBytes({ content: [], structuredContent: envelopeCandidate }) <= this.limits.resultBytes) break;
            truncated = true;
            pageEntries = pageEntries.slice(0, pageEntries.length - 1);
            nextOffset = offset + pageEntries.length;
            nextCursor = nextOffset < snapshot.entries.length
              ? this.cursor.encode(String(nextOffset), binding, { snapshotHash: sHash, pageSize }, cursorScope)
              : null;
            result = buildPageResult(pageEntries, nextCursor, true);
            sourceTargets = pageEntries.map(e => ({ calendarId: e.calendarId, calendarLabel: e.label }));
            source = this.buildSourceV2(
              binding, sourceTargets, [], [binding.toolCallId],
              new Date(this.clock()).toISOString(), new Headers(), snapshot.discoveryRevision,
            );
          }

          if ((pageEntries.length === 0 && offset < snapshot.entries.length)
            || jsonBytes({ content: [], structuredContent: { outcome: 'success', result, source, receipt: null } })
              > this.limits.resultBytes) {
            throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
          }

          return this.checkedSuccessV2(binding, call, null, pageEntries.map(entry => entry.calendarId),
            { outcome: 'success', result, source, receipt: null });
        }

        case 'calendar_check_availability': {
          const discovery = await this.v2Deps!.readDiscovery({
            account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
            consumeRequest: admit, consumeRefreshRequest: input.consumeRefreshRequest,
          });
          const snapshot = discovery.snapshot;
          let calendarIds: string[];
          if (call.arguments.calendarIds !== undefined) {
            const primaryEntry = snapshot.entries.find(e => e.primary);
            if (call.arguments.calendarIds.some(id => id === 'primary') && !primaryEntry) {
              throw toolFault('clarification', 'CALENDAR_TARGET_UNKNOWN');
            }
            calendarIds = call.arguments.calendarIds.map(id => (id === 'primary' ? primaryEntry!.calendarId : id));
            if (new Set(calendarIds).size !== calendarIds.length) {
              throw toolFault('clarification', 'CALENDAR_INPUT_REJECTED');
            }
            for (const id of calendarIds) {
              const entry = snapshot.entries.find(e => e.calendarId === id);
              if (!entry || !entry.capabilities.availability) {
                throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
              }
            }
          } else {
            calendarIds = snapshot.entries.map(e => e.calendarId);
          }

          if (calendarIds.length === 0) {
            throw toolFault('clarification', 'CALENDAR_TARGET_UNKNOWN');
          }

          const sourceTargets = calendarIds.map(id => {
            const entry = snapshot.entries.find(e => e.calendarId === id);
            return { calendarId: id, calendarLabel: entry ? entry.label : null };
          });

          const setHash = sha256(JSON.stringify([...calendarIds].sort()));
          const sourceSkeleton = this.buildSourceV2(
            binding, sourceTargets, [], [binding.toolCallId],
            new Date(this.clock()).toISOString(), new Headers(),
            snapshot.discoveryRevision, snapshot.discoveryRevision, setHash,
          );

          const overheadBytes = jsonBytes({
            content: [],
            structuredContent: {
              outcome: 'success',
              result: null,
              source: sourceSkeleton,
              receipt: null,
            },
          }) - 4;
          const availabilityBodyBytes = Math.min(15360, this.limits.resultBytes - overheadBytes);
          if (availabilityBodyBytes < 1) throw toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');

          const result = await this.v2Deps!.credentials.withAccessToken({
            account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
            consumeRefreshRequest: input.consumeRefreshRequest,
          }, async (accessToken) => {
            return this.v2Deps!.availability.check({
              account: toAccountBinding(binding),
              accessToken,
              signal,
              grantedScopes: discovery.grantedScopes,
              policyAllows: true,
              retentionPolicy: snapshot.retentionPolicyId ? {
                policyId: snapshot.retentionPolicyId,
                expiresAt: snapshot.retentionExpiresAt,
              } : null,
              now: new Date(this.clock()).toISOString(),
              deadlineAt: binding.deadlineAt,
              consumeRequest: admit,
              snapshot,
              calendarIds,
              timeMin: call.arguments.timeMin,
              timeMax: call.arguments.timeMax,
              timeZone: call.arguments.timeZone,
              availabilityRevision: snapshot.discoveryRevision,
              purpose: 'availability',
              limits: {
                batchCalendars: this.limits.availabilityBatchCalendars,
                batches: this.limits.availabilityBatches,
                busyIntervals: this.limits.busyIntervalsIngested,
                workingBytes: this.limits.snapshotBytes,
                resultBytes: availabilityBodyBytes,
              },
            });
          });

          const source = this.buildSourceV2(
            binding, sourceTargets, [], [binding.toolCallId],
            new Date(this.clock()).toISOString(), new Headers(),
            snapshot.discoveryRevision, result.availabilityRevision, result.calendarSetHash,
          );

          return this.checkedSuccessV2(binding, call, null, calendarIds,
            { outcome: 'success', result, source, receipt: null });
        }
      }
    } catch (error) {
      return { outcome: 'failure', failure: toFailure(error) };
    }
    });
    diagnose(this.diagnostic, { ...scope, stage: 'tool-execution',
      state: result.outcome === 'success' ? 'ok' : 'error', durationMs: performance.now() - startedAt });
    return result;
    } catch (error) {
      diagnose(this.diagnostic, { ...scope, stage: 'tool-execution', state: 'error', durationMs: performance.now() - startedAt });
      throw error;
    }
  }

  async readback(input: {
    binding: CalendarExecutionBindingV2;
    operation: CalendarOperationV2;
    signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<{ outcome: 'matched'; receipt: CalendarReceiptV2 } | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  async readback(input: {
    binding: CalendarExecutionBinding;
    operation: CalendarOperation;
    signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<{ outcome: 'matched'; receipt: CalendarReceipt } | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  async readback(input: {
    binding: CalendarExecutionBinding | CalendarExecutionBindingV2;
    operation: CalendarOperation | CalendarOperationV2;
    signal: AbortSignal;
    consumeRequest: (kind: any) => Promise<void>;
    consumeRefreshRequest: () => Promise<void>;
  }): Promise<
    { outcome: 'matched'; receipt: CalendarReceipt | CalendarReceiptV2 }
    | { outcome: 'absent' | 'mismatch' | 'unknown' }
  > {
    if (this.closed) return { outcome: 'unknown' };
    return this.track(async () => {
    if (input.binding.schemaRevision === 'google-calendar.v2') {
      try {
        const binding = calendarExecutionBindingV2Schema.parse(input.binding);
        const operation = input.operation as CalendarOperationV2;
        if (!binding.target || binding.target.calendarId !== operation.calendarId) {
          return { outcome: 'unknown' };
        }
        const deadlineAt = Date.parse(binding.deadlineAt);
        if (!Number.isFinite(deadlineAt)) return { outcome: 'unknown' };
        const remaining = deadlineAt - this.clock();
        if (remaining <= 0) return { outcome: 'unknown' };
        const timeoutMs = Math.min(this.limits.toolTimeoutMs, remaining);
        const signal = AbortSignal.any([input.signal, this.closing.signal, AbortSignal.timeout(timeoutMs)]);

        const requireAccount = async (): Promise<void> => {
          signal.throwIfAborted();
          const rawRecord = await this.v2Deps!.connections.get(binding.userId);
          if (!rawRecord) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
          const record = calendarConnectionV2Schema.parse(rawRecord);
          if (!record.enabled || record.status !== 'connected') {
            throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
          }
          if (record.connectionId !== binding.connectionId
            || record.connectionRevision !== binding.connectionRevision
            || record.googleSubjectId !== binding.googleSubjectId) {
            throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
          }
        };

        const admit = async (kind: CalendarRequestKindV2): Promise<void> => {
          signal.throwIfAborted();
          await requireAccount();
          await input.consumeRequest(kind);
          signal.throwIfAborted();
          await requireAccount();
          signal.throwIfAborted();
        };

        await requireAccount();
        await this.v2Deps!.gate.requireCurrent({
          target: binding.target,
          operation: 'read',
          deadlineAt: binding.deadlineAt,
          consumeRequest: () => admit('capability-recheck'),
          consumeRefreshRequest: input.consumeRefreshRequest,
          signal,
        });

        const outcome = await this.v2Deps!.credentials.withAccessToken({
          account: toAccountBinding(binding), signal, deadlineAt: binding.deadlineAt,
          consumeRefreshRequest: input.consumeRefreshRequest,
        }, async (accessToken) => {
          await requireAccount();
          const context: CalendarHttpContextV2 = {
            binding, target: binding.target!, accessToken, signal, deadlineAt: binding.deadlineAt,
            consumeRequest: admit,
          };
          return this.v2Deps!.api.readback(context, operation);
        });

        if (outcome.outcome !== 'matched') return outcome;
        const source = this.buildSourceV2(
          binding, [binding.target], [operation.operationId], [binding.toolCallId],
          outcome.response.fetchedAt, outcome.response.headers, binding.target.discoveryRevision,
        );
        const receipt = this.buildReceiptV2(binding, binding.target, operation, outcome.response, source);
        if (receipt === null) return { outcome: 'unknown' };
        return { outcome: 'matched', receipt };
      } catch {
        return { outcome: 'unknown' };
      }
    }

    // V1 readback
    try {
      const binding = input.binding as CalendarExecutionBinding;
      const deadlineAt = Date.parse(binding.deadlineAt);
      if (!Number.isFinite(deadlineAt)) return { outcome: 'unknown' };
      const remaining = deadlineAt - this.clock();
      if (remaining <= 0) return { outcome: 'unknown' };
      const timeoutMs = Math.min(this.limits.toolTimeoutMs, remaining);
      const signal = AbortSignal.any([input.signal, this.closing.signal, AbortSignal.timeout(timeoutMs)]);
      await this.v1Deps!.gate.requireCurrent(binding, signal);
      const outcome = await this.v1Deps!.credentials.withAccessToken({
        binding, signal, deadlineAt: binding.deadlineAt,
        consumeRefreshRequest: input.consumeRefreshRequest,
      }, async (accessToken) => {
        const context: CalendarHttpContext = {
          binding, accessToken, signal, deadlineAt: binding.deadlineAt,
          consumeRequest: this.effectAdmissionV1(binding, input.consumeRequest, signal),
        };
        return this.v1Deps!.api.readback(context, input.operation as CalendarOperation);
      });
      if (outcome.outcome !== 'matched') return outcome;
      const receipt = this.buildReceiptV1(binding, input.operation as CalendarOperation, outcome.response);
      if (receipt === null) return { outcome: 'unknown' };
      return { outcome: 'matched', receipt };
    } catch {
      return { outcome: 'unknown' };
    }
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closing.abort();
    this.closePromise = (async () => {
      let timer: NodeJS.Timeout | undefined;
      const expiry = new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); timer.unref?.(); });
      try { await Promise.race([Promise.allSettled([...this.pending]), expiry]); }
      finally { if (timer) clearTimeout(timer); }
    })();
    return this.closePromise;
  }

  private effectAdmissionV1(binding: CalendarExecutionBinding,
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>, signal: AbortSignal) {
    return async (kind: CalendarRequestKind): Promise<void> => {
      signal.throwIfAborted();
      await this.v1Deps!.gate.requireCurrent(binding, signal);
      await consumeRequest(kind);
      signal.throwIfAborted();
      await this.v1Deps!.gate.requireCurrent(binding, signal);
      signal.throwIfAborted();
    };
  }

  private buildReceiptV1(binding: CalendarExecutionBinding, operation: CalendarOperation,
    response: CalendarReadResponse): CalendarReceipt | null {
    if (!this.permission.minimalEvidenceAllowed) return null;
    const fetchedAt = response.fetchedAt;
    const headers = headerEvidence(response.headers, fetchedAt);
    const proposedExpiry = effectiveSourceExpiry(fetchedAt,
      [...this.policyDeadlines, ...headers.deadlines], this.permission.content === 'retained');
    const retained = this.permission.content === 'retained' && this.policyDeadlines.length > 0
      && Date.parse(proposedExpiry) > Date.parse(fetchedAt) && !headers.forbidsRetention;
    const permission = { ...this.permission, content: retained ? 'retained' as const : 'volatile' as const };
    const expiresAt = retained ? proposedExpiry : fetchedAt;
    const evidence: CalendarSourceReference = {
      schemaVersion: 1,
      sourceId: sha256(JSON.stringify({
        connectionId: binding.connectionId,
        connectionRevision: binding.connectionRevision,
        operationId: operation.operationId,
        fetchedAt,
        eventIds: [operation.googleEventId],
      })),
      plugin: 'google-calendar',
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      operationIds: [operation.operationId],
      fetchedAt,
      expiresAt,
      redactedAt: null,
      permission,
    };
    const event = response.result.tool === 'calendar_create_event' ? response.result.event : null;
    const receipt = {
      operationId: operation.operationId,
      googleEventId: operation.googleEventId,
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      targetRevision: binding.targetRevision,
      calendarIdHash: sha256(binding.calendarId),
      requestHash: operation.requestHash,
      verifiedAt: response.fetchedAt,
      source: evidence,
      htmlLink: evidence.permission.content === 'retained' && event ? event.htmlLink : null,
    };
    return calendarReceiptSchema.parse(receipt);
  }

  private checkedSuccessV2(binding: CalendarExecutionBindingV2, call: CalendarCall,
    target: CalendarResolvedTarget | null, expectedIds: readonly string[],
    value: unknown): CalendarExecutionResultV2 {
    const invalid = (): never => { throw call.name === 'calendar_create_event'
      ? toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback')
      : toolFault('delivery', 'CALENDAR_RESPONSE_INVALID'); };
    let bytes: number;
    try { bytes = jsonBytes({ content: [], structuredContent: value }); }
    catch { return invalid(); }
    if (bytes > this.limits.resultBytes) {
      throw call.name === 'calendar_create_event' ? toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback')
        : toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE');
    }
    const parsed = calendarExecutionEnvelopeV2Schema.safeParse(value);
    if (!parsed.success || parsed.data.outcome !== 'success') return invalid();
    const envelope = parsed.data;
    const { result, source, receipt } = envelope;
    if (result.tool !== call.name || source.connectionId !== binding.connectionId
      || source.connectionRevision !== binding.connectionRevision
      || !source.toolCallIds.includes(binding.toolCallId)) return invalid();
    const ids = source.targets.map(item => item.calendarId).sort();
    if (JSON.stringify(ids) !== JSON.stringify([...expectedIds].sort())) return invalid();
    if ('target' in result) {
      if (!target || result.target.calendarId !== target.calendarId
        || result.target.calendarLabel !== target.calendarLabel
        || result.target.discoveryRevision !== target.discoveryRevision
        || result.target.privateAccess !== target.privateAccess) return invalid();
    }
    if (result.tool === 'calendar_get_event' && call.name === 'calendar_get_event'
      && result.event.eventId !== call.arguments.eventId) return invalid();
    if (result.tool === 'calendar_create_event') {
      const operation = binding.operation;
      if (!target || !operation || !receipt || result.event.eventId !== operation.googleEventId
        || !source.operationIds.includes(operation.operationId)
        || receipt.operationId !== operation.operationId || receipt.googleEventId !== operation.googleEventId
        || receipt.requestHash !== operation.requestHash || receipt.connectionId !== binding.connectionId
        || receipt.connectionRevision !== binding.connectionRevision || receipt.targetRevision !== target.targetRevision
        || receipt.calendarId !== target.calendarId
        || (receipt.calendarLabel !== null && receipt.calendarLabel !== target.calendarLabel)) return invalid();
    } else if (receipt !== null) return invalid();
    if (result.tool === 'calendar_list_calendars'
      && result.calendars.some(item => !expectedIds.includes(item.calendarId))) return invalid();
    if (result.tool === 'calendar_check_availability') {
      if (result.connectionId !== binding.connectionId || result.connectionRevision !== binding.connectionRevision
        || result.calendarSetHash !== sha256(JSON.stringify(ids))
        || result.calendars.some(item => !expectedIds.includes(item.calendarId))) return invalid();
      if (result.coverage === 'complete' && result.calendars.length !== expectedIds.length) return invalid();
      if (result.coverage !== 'complete' && (!result.limitations.length
        || result.conflict === 'clear' || result.free.length > 0)) return invalid();
    }
    return envelope;
  }

  private buildSuccessV2(
    binding: CalendarExecutionBindingV2,
    call: CalendarCall,
    target: CalendarResolvedTarget,
    operation: CalendarOperationV2 | null,
    response: CalendarReadResponseV2,
  ): CalendarExecutionResultV2 {
    const invalid = (): never => { throw call.name === 'calendar_create_event'
      ? toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback')
      : toolFault('delivery', 'CALENDAR_RESPONSE_INVALID'); };
    let result;
    try { result = calendarResultV2Schema.parse(response.result); }
    catch (error) {
      if (error instanceof CalendarToolFault) throw error;
      return invalid();
    }
    const bytes = jsonBytes(result);
    if (bytes + ENVELOPE_HEADROOM_BYTES > this.limits.resultBytes) {
      throw operation === null
        ? toolFault('delivery', 'CALENDAR_RESULT_TOO_LARGE')
        : toolFault('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
    }
    try {
      const source = this.buildSourceV2(
        binding,
        [{ calendarId: target.calendarId, calendarLabel: target.calendarLabel }],
        operation === null ? [] : [operation.operationId],
        [binding.toolCallId],
        response.fetchedAt,
        response.headers,
        target.discoveryRevision,
      );
      const receipt = operation === null ? null : this.buildReceiptV2(binding, target, operation, response, source);
      if (call.name !== 'calendar_create_event' && receipt !== null) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      return this.checkedSuccessV2(binding, call, target, [target.calendarId],
        { outcome: 'success' as const, result, source, receipt });
    } catch (error) {
      if (error instanceof CalendarToolFault) throw error;
      return invalid();
    }
  }

  private buildSourceV2(
    binding: CalendarExecutionBindingV2,
    targets: readonly { calendarId: string; calendarLabel: string | null }[],
    operationIds: readonly string[],
    toolCallIds: readonly string[],
    fetchedAt: string,
    headers: Headers,
    discoveryRevision: number,
    availabilityRevision: number | null = null,
    calendarSetHash: string | null = null,
  ): CalendarSourceReferenceV2 {
    const hEvidence = headerEvidence(headers, fetchedAt);
    const proposedExpiry = effectiveSourceExpiry(fetchedAt,
      [...this.policyDeadlines, ...hEvidence.deadlines], this.permission.content === 'retained');
    const retained = this.permission.content === 'retained' && this.policyDeadlines.length > 0
      && Date.parse(proposedExpiry) > Date.parse(fetchedAt) && !hEvidence.forbidsRetention;
    const permission = { ...this.permission, content: retained ? 'retained' as const : 'volatile' as const };
    const expiresAt = retained ? proposedExpiry : fetchedAt;
    const sourceId = sha256(JSON.stringify({
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      targetIds: targets.map(t => t.calendarId).sort(),
      operationIds,
      toolCallIds,
      fetchedAt,
      availabilityRevision,
      calendarSetHash,
    }));
    return sourceReferenceV2Schema.parse({
      schemaVersion: 2,
      sourceId,
      plugin: 'google-calendar',
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      operationIds: [...operationIds],
      toolCallIds: [...toolCallIds],
      fetchedAt,
      expiresAt,
      redactedAt: null,
      permission,
      discoveryRevision,
      availabilityRevision,
      calendarSetHash,
      targets: targets.map(t => ({
        calendarId: t.calendarId,
        calendarLabel: permission.content === 'retained' ? t.calendarLabel : null,
      })),
    });
  }

  private buildReceiptV2(
    binding: CalendarExecutionBindingV2,
    target: CalendarResolvedTarget,
    operation: CalendarOperationV2,
    response: CalendarReadResponseV2,
    source: CalendarSourceReferenceV2,
  ): CalendarReceiptV2 | null {
    if (!this.permission.minimalEvidenceAllowed) return null;
    const event = response.result.tool === 'calendar_create_event' ? response.result.event : null;
    const isRetained = source.permission.content === 'retained';
    return calendarReceiptV2Schema.parse({
      schemaVersion: 2,
      operationId: operation.operationId,
      googleEventId: operation.googleEventId,
      connectionId: binding.connectionId,
      connectionRevision: binding.connectionRevision,
      targetRevision: target.targetRevision,
      calendarId: target.calendarId,
      calendarLabel: isRetained ? target.calendarLabel : null,
      labelExpiresAt: isRetained ? source.expiresAt : null,
      requestHash: operation.requestHash,
      verifiedAt: response.fetchedAt,
      source,
      htmlLink: isRetained && event ? event.htmlLink : null,
    });
  }
}
