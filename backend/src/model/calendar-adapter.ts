/**
 * ============================================================================
 * FILE: calendar-adapter.ts
 * LOCATION: backend/src/model/calendar-adapter.ts
 * ============================================================================
 *
 * PURPOSE:
 *    OpenRouter calendar model adapter supporting streaming decisions and v2 repairs.
 *
 * ROLE IN PROJECT:
 *    Streams OpenRouter SSE completions, manages deadlines/observations, parses tool
 *    candidates, and produces verified decisions or bounded v2 schema repair evidence.
 *
 * KEY COMPONENTS:
 *    - OpenRouterCalendarAdapter: Core streaming adapter implementing calendar model ports.
 *    - createCalendarModelPort: Legacy factory refusing v2 dispatches before fetch.
 *    - createCalendarModelPortV2: Production v2 factory enforcing CalendarModelDispatchV2.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { diagnose, type DiagnosticSink } from '../chat-runtime/ports.js';
import { CALENDAR_TOOLS, CALENDAR_TOOLS_V1, SKILL_NATIVE_TOOLS } from '../contracts/calendar-tools.js';
import type { CalendarDecisionChunkV2, CalendarDecisionRequest, CalendarModelPort, CalendarModelPortV2, CalendarRejectedDecisionV2, SkillDecisionChunk, SkillDecisionRequest, SkillModelPort } from '../contracts/calendar-model.js';
import { rejectedDecisionSchema, rejectedDecisionV2Schema, skillDecisionSchema } from '../contracts/calendar-model.js';
import { CALENDAR_TOOL_REVISION, calendarFailureSchema, type CalendarFailure } from '../contracts/calendar-policy.js';
import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS, type ModelConfig, type ModelLimits } from './policy.js';
import { buildCalendarBody, type CalendarDispatchBinding, type CalendarDispatchBindingV2 } from './calendar-policy.js';
import { CalendarStreamAssembly } from './calendar-stream.js';
import { emptyCalendarObservation, mergeCalendarObservation } from './calendar-usage.js';
import { RunDeadlines, bounded, readJson } from './deadlines.js';
import { parseSse } from './sse.js';
import { identifier } from './accounting.js';
import { mayRetryRejection, object, providerFault } from './faults.js';
import { StreamTiming } from '../benchmark/stream-timing.js';

export const CALENDAR_DIAGNOSTIC_FINGERPRINTS = {
  'google-calendar.v1': createHash('sha256').update(JSON.stringify(CALENDAR_TOOLS_V1)).digest('hex'),
  'google-calendar.v2': createHash('sha256').update(JSON.stringify(CALENDAR_TOOLS)).digest('hex'),
} as const;
export const SKILL_NATIVE_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(SKILL_NATIVE_TOOLS)).digest('hex');

function failureChunk(failure: CalendarFailure): { type: 'failure'; failure: CalendarFailure } {
  return { type: 'failure', failure: calendarFailureSchema.parse(failure) };
}

function mapAppError(error: AppError, spend = false): CalendarFailure {
  if (error.code === 'CANCELLED') return calendarFailureSchema.parse({ category: 'cancelled', code: 'CANCELLED', retry: 'none' });
  if (error.code === 'PERSISTENCE_ERROR') return calendarFailureSchema.parse({ category: 'persistence', code: 'PERSISTENCE_ERROR', retry: 'none' });
  if (error.code === 'STORAGE_BUDGET_EXCEEDED' && spend) {
    return calendarFailureSchema.parse({ category: 'budget', code: 'MODEL_SPEND_EXCEEDED', retry: 'none' });
  }
  if (error.code === 'STORAGE_BUDGET_EXCEEDED') {
    return calendarFailureSchema.parse({ category: 'budget', code: 'ARGUMENT_BUDGET_EXCEEDED', retry: 'none' });
  }
  if (error.code === 'CONTEXT_BUDGET_EXCEEDED' || error.code === 'INPUT_TOO_LARGE') {
    return calendarFailureSchema.parse({ category: 'budget', code: error.code, retry: 'none' });
  }
  if (error.code === 'TIMEOUT') return calendarFailureSchema.parse({ category: 'provider', code: 'TIMEOUT', retry: 'none' });
  return calendarFailureSchema.parse({ category: 'provider', code: error.code.replace(/[^A-Z0-9_]/g, '').slice(0, 64) || 'PROVIDER_ERROR', retry: 'none' });
}

function mapUnknown(error: unknown, spend = false): CalendarFailure {
  if (error instanceof AppError) return mapAppError(error, spend);
  return calendarFailureSchema.parse({ category: 'provider', code: 'PROVIDER_ERROR', retry: 'none' });
}

export class OpenRouterCalendarAdapter implements CalendarModelPortV2, SkillModelPort {
  private used = false;
  private readonly binding: CalendarDispatchBinding;
  constructor(private config: ModelConfig, private modelLimits: ModelLimits,
    binding: CalendarDispatchBinding, private fetcher: typeof fetch = fetch,
    private diagnostic?: DiagnosticSink) {
    this.binding = binding;
  }

  stream(request: SkillDecisionRequest): AsyncGenerator<SkillDecisionChunk>;
  stream(request: CalendarDecisionRequest): AsyncGenerator<CalendarDecisionChunkV2>;
  async *stream(request: SkillDecisionRequest | CalendarDecisionRequest):
    AsyncGenerator<SkillDecisionChunk | CalendarDecisionChunkV2> {
    if (this.used) {
      yield failureChunk({ category: 'provider', code: 'INVALID_REQUEST', retry: 'none' });
      return;
    }
    this.used = true;
    let deadlines: RunDeadlines | undefined;
    let http: Response | undefined;
    let started = false;
    let observation = emptyCalendarObservation();
    let lastObserved = '';
    let cleaned = false;
    let reportedGeneration = false;
    let streamTiming: StreamTiming | undefined;
    const revision = this.binding.dispatch.schemaRevision;
    const report: DiagnosticSink = fields => diagnose(this.diagnostic, {
      ...fields, dispatchId: request.dispatchId, decisionId: request.decisionId,
      schemaRevision: revision,
      schemaFingerprint: revision === 'google-calendar.v1' || revision === 'google-calendar.v2'
        ? CALENDAR_DIAGNOSTIC_FINGERPRINTS[revision] : undefined,
      correctionAttempt: this.binding.budget.repairs, correctionLimit: this.binding.limits.repairs,
      dispatchKind: ['initial', 'continuation', 'schema-repair'].includes(this.binding.dispatch.reason)
        ? this.binding.dispatch.reason : undefined,
    });
    let assembly!: CalendarStreamAssembly;

    const publish = async (ended: boolean, signal: AbortSignal, priority = false): Promise<CalendarDecisionChunkV2 | null> => {
      const next = ended ? { ...observation, endedAt: observation.endedAt ?? new Date().toISOString() } : observation;
      observation = next;
      const signature = JSON.stringify(next);
      if (signature === lastObserved && !ended) return null;
      lastObserved = signature;
      if (priority || ended || !this.binding.hooks.enqueueObservation) {
        await bounded(this.binding.hooks.onObservation(next), this.config.budgets.persistenceTimeoutMs, signal, 'PERSISTENCE_ERROR');
      } else {
        this.binding.hooks.checkObservations?.();
        this.binding.hooks.enqueueObservation(next);
      }
      return { type: 'usage', observation: next };
    };

    const cleanupObserve = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      observation = { ...observation, endedAt: observation.endedAt ?? new Date().toISOString() };
      const cleanup = new AbortController();
      try {
        await bounded(this.binding.hooks.onObservation(observation), this.config.budgets.persistenceTimeoutMs, cleanup.signal, 'PERSISTENCE_ERROR');
        lastObserved = JSON.stringify(observation);
      } catch {
        throw new AppError('PERSISTENCE_ERROR', 'The chat accounting could not be saved.', false);
      }
    };

    try {
      if (request.signal.aborted) {
        yield failureChunk({ category: 'cancelled', code: 'CANCELLED', retry: 'none' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = buildCalendarBody(this.config, this.modelLimits, request, this.binding);
      } catch (error) {
        yield failureChunk(mapUnknown(error, true));
        return;
      }
      assembly = new CalendarStreamAssembly(SKILL_NATIVE_TOOLS, this.binding.limits,
        fields => report(fields));
      deadlines = new RunDeadlines(this.config.budgets, request.signal, request.deadlineAt);
      if (deadlines.signal.aborted) {
        yield failureChunk(mapAppError(deadlines.failure()));
        return;
      }
      try {
        await bounded(this.binding.hooks.beforeDispatch(), this.config.budgets.persistenceTimeoutMs, deadlines.signal, 'PERSISTENCE_ERROR');
      } catch (error) {
        yield failureChunk(error instanceof AppError && error.code === 'CANCELLED'
          ? { category: 'cancelled', code: 'CANCELLED', retry: 'none' }
          : { category: 'persistence', code: 'PERSISTENCE_ERROR', retry: 'none' });
        return;
      }
      deadlines.check();
      started = true;
      deadlines.armConnect();
      const startedAt = performance.now();
      streamTiming = new StreamTiming(report, {});
      report({ stage: 'model-dispatch', state: 'start', provider: 'openrouter',
        requestKind: 'model', origin: 'provider', delivery: 'attempted' });
      try {
        http = await this.fetcher(`${OPENROUTER_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.openRouter.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'Aurvin',
          },
          body: JSON.stringify(body),
          signal: deadlines.signal,
          redirect: 'error',
        });
      } catch {
        report({ stage: 'model-dispatch', state: 'error', provider: 'openrouter',
          requestKind: 'model', origin: 'provider', delivery: 'attempted',
          reason: 'provider-error', code: 'INTERRUPTED', durationMs: performance.now() - startedAt });
        deadlines.check();
        throw new AppError('INTERRUPTED', 'The response could not be confirmed. Retry to continue.', false);
      }
      report({ stage: 'model-response', state: http.ok ? 'ok' : 'error', provider: 'openrouter',
        requestKind: 'model', origin: 'provider', delivery: 'response-received',
        durationMs: performance.now() - startedAt,
        statusClass: http.status >= 500 ? '5xx' : http.status >= 400 ? '4xx'
          : http.status >= 300 ? '3xx' : http.status >= 200 ? '2xx' : 'other' });
      const headerId = identifier(http.headers.get('x-request-id') ?? http.headers.get('openrouter-request-id') ?? '');
      if (headerId) {
        observation = { ...observation, providerRequestId: observation.providerRequestId ?? headerId };
        report({ stage: 'model-response', provider: 'openrouter', providerRequestId: headerId,
          origin: 'provider', delivery: 'response-received' });
      }
      deadlines.headers();
      if (!http.ok) {
        const parsed = await readJson(http, TRANSPORT_LIMITS.jsonBytes);
        observation = mergeCalendarObservation(observation, parsed);
        if (!reportedGeneration && observation.generationId) {
          reportedGeneration = true;
          report({ stage: 'model-response', provider: 'openrouter', generationId: observation.generationId,
            origin: 'provider', delivery: 'response-received' });
        }
        const usage = await publish(true, deadlines.signal, true);
        if (usage) yield usage;
        const hasGeneration = Boolean(observation.generationId);
        const retryable = mayRetryRejection(http.status, parsed, hasGeneration, false);
        const fault = providerFault(http.status, object(object(parsed).error).code);
        if (retryable) {
          // The caller seals this rejection; no retry is admitted here.
          yield failureChunk({ category: 'provider', code: fault.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_ERROR', retry: 'provider-rejection' });
          return;
        }
        yield failureChunk(mapAppError(fault));
        return;
      }
      if (!http.body || !http.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        throw new AppError('PROVIDER_ERROR', 'The model service returned an invalid stream.', false);
      }
      let providerEnd = false;
      let sawFinish = false;
      let firstMeaningful = false;
      for await (const frame of parseSse(http.body)) {
        deadlines.check();
        deadlines.frame();
        if (frame.type === 'comment') continue;
        if (frame.data === '[DONE]') {
          if (!sawFinish) throw new AppError('INTERRUPTED', 'The response stream ended early. Retry to continue.', false);
          providerEnd = true;
          break;
        }
        let raw: unknown;
        try { raw = JSON.parse(frame.data) as unknown; }
        catch { throw new AppError('PROVIDER_ERROR', 'The response stream was invalid.', false); }
        streamTiming.frame(raw);
        observation = mergeCalendarObservation(observation, raw);
        let newlyObservedId = false;
        if (!reportedGeneration && observation.generationId) {
          reportedGeneration = true;
          newlyObservedId = true;
          report({ stage: 'model-response', provider: 'openrouter', generationId: observation.generationId,
            origin: 'provider', delivery: 'response-received' });
        }
        const usage = await publish(false, deadlines.signal, newlyObservedId);
        if (usage) yield usage;
        const top = object(raw);
        if (top.error !== undefined) {
          const fault = providerFault(200, object(top.error).code);
          throw new AppError(fault.code, fault.message, false);
        }
        const choices = top.choices;
        const choice = object(Array.isArray(choices) ? choices[0] : undefined);
        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length' || choice.finish_reason === 'tool_calls') {
          sawFinish = true;
        }
        const provisional = assembly.push(raw);
        if (provisional.meaningfulOutput) {
          if (!firstMeaningful) report({ stage: 'model-first-output', state: 'ok', provider: 'openrouter',
            requestKind: 'model', durationMs: performance.now() - startedAt,
            origin: 'provider', delivery: 'response-received' });
          firstMeaningful = true;
          deadlines.firstText();
          if (!observation.firstOutputAt) observation = { ...observation, firstOutputAt: new Date().toISOString() };
        }
        this.binding.hooks.checkObservations?.();
        if (provisional.text) yield { type: 'text-delta', text: provisional.text };
      }
      if (!providerEnd) throw new AppError('INTERRUPTED', 'The response stream ended early. Retry to continue.', false);
      streamTiming.end(true);
      deadlines.providerFinished();
      report({ stage: 'model-complete', state: 'ok', provider: 'openrouter', requestKind: 'model',
        durationMs: performance.now() - startedAt, origin: 'provider', delivery: 'response-received',
        promptTokens: observation.promptTokens, completionTokens: observation.completionTokens,
        cachedPromptTokens: observation.cachedPromptTokens, reasoningOutputTokens: observation.reasoningOutputTokens });
      deadlines.check();
      this.binding.hooks.checkObservations?.();
      const result = assembly.finish();
      const ended = await publish(true, deadlines.signal, true);
      if (ended) yield ended;
      if (this.binding.hooks.flushObservations) {
        await this.binding.hooks.flushObservations();
      }
      if ('kind' in result && result.kind === 'text') {
        report({ stage: 'model-decision', state: 'ok', decisionKind: 'text', origin: 'local', delivery: 'not-sent' });
        yield { type: 'decision', decision: skillDecisionSchema.parse({
          kind: 'text', decisionId: request.decisionId, content: result.content, truncated: result.truncated,
        }) };
        return;
      }
      if ('kind' in result && result.kind === 'valid') {
        const decision = skillDecisionSchema.parse({
          kind: result.nativeCall.function.name, decisionId: request.decisionId,
          nativeCall: result.nativeCall, assistantContent: result.assistantContent,
          envelope: result.envelope, terminal: 'tool_calls',
        });
        report({ stage: 'model-decision', state: 'ok', decisionKind: 'tool',
          tool: decision.kind === 'text' ? undefined : decision.kind,
          toolCallId: result.nativeCall.id, origin: 'local', delivery: 'not-sent' });
        yield { type: 'decision', decision };
        return;
      }
      if ('kind' in result && result.kind === 'rejected') {
        report({ stage: 'model-decision', state: 'rejected', decisionKind: 'rejected', origin: 'local', delivery: 'not-sent' });
        if (this.binding.dispatch.schemaVersion === 2) {
          yield { type: 'rejected', evidence: rejectedDecisionV2Schema.parse({
            schemaVersion: 2, kind: 'calendar-rejected-decision',
            userId: this.binding.dispatch.userId, sessionId: this.binding.dispatch.sessionId,
            turnId: this.binding.dispatch.turnId, attemptId: this.binding.dispatch.attemptId,
            decisionId: request.decisionId, dispatchId: request.dispatchId,
            dispatchIndex: this.binding.dispatch.dispatchIndex, repairsUsed: this.binding.budget.repairs,
            rawArgumentsSha256: result.rawArgumentsSha256, diagnostics: result.diagnostics,
            schemaRevision: CALENDAR_TOOL_REVISION,
            createdAt: new Date().toISOString(),
          }) };
        } else {
          yield { type: 'rejected', evidence: rejectedDecisionSchema.parse({
            schemaVersion: 1, kind: 'calendar-rejected-decision',
            userId: this.binding.dispatch.userId, sessionId: this.binding.dispatch.sessionId,
            turnId: this.binding.dispatch.turnId, attemptId: this.binding.dispatch.attemptId,
            decisionId: request.decisionId, dispatchId: request.dispatchId,
            dispatchIndex: this.binding.dispatch.dispatchIndex, repairsUsed: this.binding.budget.repairs,
            rawArgumentsSha256: result.rawArgumentsSha256, diagnostics: result.diagnostics,
            createdAt: new Date().toISOString(),
          }) as unknown as CalendarRejectedDecisionV2 };
        }
        const canRepair = this.binding.budget.repairs < this.binding.limits.repairs;
        yield failureChunk(canRepair
          ? { category: 'structural', code: 'STRUCTURAL_VALIDATION_FAILED', retry: 'schema-repair' }
          : { category: 'budget', code: 'REPAIR_EXHAUSTED', retry: 'none' });
        return;
      }
      if ('kind' in result && result.kind === 'failure') {
        report({ stage: 'model-decision', state: 'error', decisionKind: 'failure', code: result.failure.code,
          origin: 'local', delivery: 'not-sent' });
        yield failureChunk(result.failure);
        return;
      }
    } catch (error) {
      this.binding.hooks.checkObservations?.();
      try { if (started) await cleanupObserve(); }
      catch { yield failureChunk({ category: 'persistence', code: 'PERSISTENCE_ERROR', retry: 'none' }); return; }
      if (observation.endedAt) yield { type: 'usage', observation };
      yield failureChunk(mapUnknown(error));
    } finally {
      streamTiming?.end(false);
      if (started && !cleaned && !observation.endedAt) {
        try { await cleanupObserve(); } catch { /* terminal path already mapped */ }
      }
      if (this.binding.hooks.flushObservations) {
        await this.binding.hooks.flushObservations().catch(() => undefined);
      }
      deadlines?.stop();
      deadlines?.dispose();
    }
  }
}

export function createCalendarModelPort(config: ModelConfig, modelLimits: ModelLimits,
  binding: CalendarDispatchBinding, fetcher: typeof fetch = fetch,
  diagnostic?: DiagnosticSink): CalendarModelPort {
  const d = binding.dispatch as { schemaRevision?: string; schemaVersion?: number };
  if (d.schemaVersion === 2 || d.schemaRevision === 'google-calendar.v2') {
    throw new AppError('INVALID_REQUEST', 'Legacy calendar adapter does not support v2 dispatch.', false);
  }
  return new OpenRouterCalendarAdapter(config, modelLimits, binding, fetcher, diagnostic) as unknown as CalendarModelPort;
}

export function createCalendarModelPortV2(config: ModelConfig, modelLimits: ModelLimits,
  binding: CalendarDispatchBindingV2, fetcher: typeof fetch = fetch,
  diagnostic?: DiagnosticSink): CalendarModelPortV2 {
  const d = binding.dispatch as { schemaRevision?: string; schemaVersion?: number };
  if (d.schemaVersion !== 2 || d.schemaRevision !== 'google-calendar.v2') {
    throw new AppError('INVALID_REQUEST', 'Calendar model adapter requires v2 dispatch.', false);
  }
  return new OpenRouterCalendarAdapter(config, modelLimits, binding, fetcher, diagnostic);
}
