/**
 * ============================================================================
 * FILE: chat-http.service.ts
 * LOCATION: backend/src/http/chat-http.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Project scoped session/message reads and delegate P5 chat commands.
 *
 * ROLE IN PROJECT:
 *    Keeps HTTP controllers thin: server identity, input bounds, and strict
 *    response schemas sit here while acceptance, retry, cancel, and status
 *    remain owned by the injected ChatRuntime.
 *
 * KEY COMPONENTS:
 *    - sessions/session/messages: Ownership-scoped archive projections.
 *    - submit/retry/cancel/status: Validated command and result mapping.
 * ============================================================================
 */

import { submitTurnRequestSchema, retryTurnRequestSchema, retrySaveRequestSchema, cancelTurnRequestSchema, submitTurnResponseSchema,
  sessionSummarySchema, listSessionsResponseSchema, listMessagesResponseSchema, turnStatusResponseSchema } from '../contracts/api.js';
import { AppError } from '../platform/errors/app-error.js';
import type { ChatHttpOptions } from './options.js';
import { parseBody, pageQuery, pathId, inputBounds } from './validation.js';
import { errorBody } from './client-errors.js';
import { z } from 'zod';
const sessionUpdateSchema = z.object({ title: z.string().trim().min(1).max(80).optional(),
  pinned: z.boolean().optional() }).strict().refine(body => body.title !== undefined || body.pinned !== undefined);
export class ChatHttpService {
  constructor(readonly o: ChatHttpOptions) {}
  async sessions(query: unknown) {
    const identity = this.o.identity.resolve(), page = pageQuery(query, this.o.budgets);
    const userId = identity.userId;
    const durable = await this.o.sessions.list(userId, page);
    return listSessionsResponseSchema.parse(this.o.runtime.overlaySessions?.(userId, page, durable) ?? durable);
  }
  async session(id: string) {
    const identity = this.o.identity.resolve();
    const userId = identity.userId;
    const record = this.o.runtime.memorySession?.(userId, pathId(id)) ?? await this.o.sessions.get(userId,pathId(id));
    if (!record || record.lifecycle !== 'active' || record.userId !== userId || record.sessionId !== id)
      throw new AppError('NOT_FOUND','Chat not found.');
    return sessionSummarySchema.parse({ sessionId:record.sessionId, title:record.title,
      createdAt:record.createdAt,lastActivityAt:record.lastActivityAt, ...(record.pinned !== undefined ? { pinned:record.pinned } : {}) });
  }
  async updateSession(id: string, raw: unknown) {
    const identity = this.o.identity.resolve();
    const changes = parseBody(sessionUpdateSchema,raw,this.o.identity);
    this.o.runtime.assertSessionMutation?.(identity.userId, pathId(id));
    await this.o.sessions.update(identity.userId,pathId(id),changes);
    return this.session(id);
  }
  async deleteSession(id: string) {
    const identity = this.o.identity.resolve();
    this.o.runtime.assertSessionMutation?.(identity.userId, pathId(id));
    await this.o.sessions.delete(identity.userId,pathId(id));
  }
  async messages(id: string, query: unknown) {
    const identity = this.o.identity.resolve();
    const page = pageQuery(query,this.o.budgets), userId = identity.userId;
    pathId(id);
    const memory = this.o.runtime.memoryMessages?.(userId, id, page);
    if (memory) return listMessagesResponseSchema.parse(memory);
    const session = await this.o.sessions.get(userId, id);
    if (!session || session.userId !== userId || session.sessionId !== id || session.lifecycle !== 'active')
      throw new AppError('NOT_FOUND', 'Chat not found.');
    const listed = session.memoryPublication
      ? await (async () => {
          if (!this.o.messages.listPublished) throw new AppError('NOT_READY', 'Saved history is unavailable.');
          return this.o.messages.listPublished(userId, id, page,
            session.memoryPublication!.version === 0 ? -1 : session.memoryPublication!.sequence);
        })()
      : await this.o.messages.list(userId, id, page);
    const activeTurn = session.execution?.activeAttemptId && this.o.runtime.activeSessionTurn
      ? await this.o.runtime.activeSessionTurn(userId, id)
      : null;
    return listMessagesResponseSchema.parse(activeTurn ? { ...listed, activeTurn } : listed);
  }
  async submit(sessionId: string | null, raw: unknown) {
    const identity = this.o.identity.resolve();
    this.o.identity.assertNoClientOverrides(raw);
    if (raw && typeof raw === 'object' && 'content' in raw && typeof raw.content === 'string') inputBounds(raw.content, { ...this.o.budgets, maxInputChars: 32000 });
    const body = parseBody(submitTurnRequestSchema,raw,this.o.identity);
    if (this.o.currentConfig?.current()?.calendar?.enabled && body.calendarProtocol !== 2) {
      throw new AppError('INVALID_REQUEST', 'Calendar stream support is required.', false);
    }
    if (body.sessionId !== sessionId) throw new AppError('INVALID_REQUEST','Body and route disagree.');
    if (sessionId !== null) pathId(sessionId);
    if (sessionId !== null) this.o.executionReservations?.assertText(identity.userId, sessionId);
    return submitTurnResponseSchema.parse(await this.o.runtime.submitTurn({ ...body,identity }));
  }
  async streamStatus(sessionId: string, turnId: string) {
    const identity = this.o.identity.resolve();
    const userId = identity.userId;
    const s = pathId(sessionId);
    const t = pathId(turnId);
    const hot = this.o.runtime.getStreamAttempt ? await this.o.runtime.getStreamAttempt(userId, s, t) : null;
    if (hot) {
      return turnStatusResponseSchema.parse({
        ...hot,
        error: hot.error ? errorBody(hot.error.code, hot.error.retryable) : null,
      });
    }
    await this.session(sessionId);
    const status = await this.o.runtime.getTurnStatus(userId, s, t);
    return turnStatusResponseSchema.parse({
      ...status,
      error: status.error ? errorBody(status.error.code, status.error.retryable) : null,
    });
  }
  async status(sessionId: string, turnId: string) {
    const identity = this.o.identity.resolve();
    await this.session(sessionId);
    const status = await this.o.runtime.getTurnStatus(identity.userId,pathId(sessionId),pathId(turnId));
    const calendar = await this.o.runtime.getCalendarTurnState?.(
      identity.userId, pathId(sessionId), pathId(turnId),
    );
    return turnStatusResponseSchema.parse({
      ...status,
      error: status.error ? errorBody(status.error.code, status.error.retryable) : null,
      ...(calendar ? { calendar } : {}),
    });
  }
  async retry(sessionId: string, turnId: string, raw: unknown) {
    const identity = this.o.identity.resolve();
    const body = parseBody(retryTurnRequestSchema,raw,this.o.identity);
    if (this.o.currentConfig?.current()?.calendar?.enabled && body.calendarProtocol !== 2) {
      throw new AppError('INVALID_REQUEST', 'Calendar stream support is required.', false);
    }
    if (body.expectedEpoch !== undefined && this.o.runtime.processEpoch && body.expectedEpoch !== this.o.runtime.processEpoch()) {
      throw new AppError('INTERRUPTED', 'This request belongs to an earlier server session; its outcome is unknown.', false);
    }
    await this.session(sessionId);
    this.o.executionReservations?.assertText(identity.userId, sessionId);
    return submitTurnResponseSchema.parse(await this.o.runtime.retryTurn({ ...body,identity,
      sessionId:pathId(sessionId),turnId:pathId(turnId) }));
  }
  async retrySave(sessionId: string, turnId: string, raw: unknown) {
    const identity = this.o.identity.resolve();
    const body = parseBody(retrySaveRequestSchema, raw, this.o.identity);
    if (!this.o.runtime.retrySave) throw new AppError('NOT_READY', 'Saving is unavailable.');
    return turnStatusResponseSchema.parse(await this.o.runtime.retrySave(identity.userId,
      pathId(sessionId), pathId(turnId), body));
  }
  async cancel(sessionId: string, turnId: string, raw: unknown) {
    const identity = this.o.identity.resolve();
    const body = parseBody(cancelTurnRequestSchema,raw,this.o.identity); await this.session(sessionId);
    await this.o.runtime.cancelTurn({ ...body,identity,sessionId:pathId(sessionId),turnId:pathId(turnId) });
  }
}
