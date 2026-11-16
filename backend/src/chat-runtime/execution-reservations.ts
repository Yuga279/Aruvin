/**
 * ============================================================================
 * FILE: execution-reservations.ts
 * LOCATION: backend/src/chat-runtime/execution-reservations.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Process-local reservation coordinator for multi-tab and live mode exclusion.
 *
 * ROLE IN PROJECT:
 *    Coordinates synchronous reservation slots and durable database busy checks
 *    to exclude concurrent text and live voice executions across browser tabs.
 *
 * KEY COMPONENTS:
 *    - ExecutionReservations: Implements ExecutionReservationPort for mode fencing.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ResolvedIdentity } from '../contracts/identity.js';
import { resolvedIdentitySchema } from '../contracts/identity.js';
import { idSchema } from '../contracts/identifiers.js';
import type { ExecutionReservation, ExecutionReservationPort } from '../contracts/voice.js';
import { AppError } from '../platform/errors/app-error.js';

export class ExecutionReservations implements ExecutionReservationPort {
  private entries = new Map<string, ExecutionReservation>();
  private slots = new Map<string, string>();
  private binding = new Set<string>();

  constructor(private readonly busy: (u: string, s: string) => Promise<boolean>) {}

  private scope(u: string, s: string) { return JSON.stringify([u, s]); }

  private identity(id: ResolvedIdentity) {
    const value = resolvedIdentitySchema.parse(id);
    if (value.source !== 'authenticated-session' || value.openRouterUser !== value.userId)
      throw new AppError('IDENTITY_OVERRIDE_REJECTED', 'Identity is resolved by the server.');
    return value;
  }

  private conflict(): never { throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.'); }

  assertText(u: string, s: string) {
    idSchema.parse(u);
    if (this.slots.has(this.scope(u, s))) this.conflict();
  }

  hasSession(u: string, s: string): boolean {
    return this.slots.has(this.scope(u, s));
  }

  assertLive(value: ExecutionReservation, identity: ResolvedIdentity, s: string) {
    const id = this.identity(identity), current = this.entries.get(value.reservationId);
    if (!current || !isDeepStrictEqual(current, value) || current.userId !== id.userId ||
      current.owner.kind !== 'live' || current.conversationId !== s ||
      this.slots.get(this.scope(id.userId, s)) !== current.reservationId) this.conflict();
  }

  async acquire(c: Parameters<ExecutionReservationPort['acquire']>[0]) {
    const id = this.identity(c.identity);
    if (c.conversationId !== null) idSchema.parse(c.conversationId);
    idSchema.parse(c.owner.kind === 'live' ? c.owner.voiceSessionId : c.owner.attemptId);
    if (this.entries.size >= 1024) throw new AppError('CONCURRENCY_LIMIT', 'Too many reservations.');
    const r: ExecutionReservation = { reservationId: randomUUID(), userId: id.userId,
      conversationId: c.conversationId, owner: { ...c.owner } };
    const slot = r.conversationId === null ? null : this.scope(r.userId, r.conversationId);
    if (slot && this.slots.has(slot)) this.conflict();
    this.entries.set(r.reservationId, r); if (slot) this.slots.set(slot, r.reservationId);
    try {
      if (r.conversationId !== null && await this.busy(r.userId, r.conversationId)) this.conflict();
      return structuredClone(r);
    } catch (error) {
      this.entries.delete(r.reservationId);
      if (slot && this.slots.get(slot) === r.reservationId) this.slots.delete(slot);
      throw error;
    }
  }

  async bindConversation(c: Parameters<ExecutionReservationPort['bindConversation']>[0]) {
    const id = this.identity(c.identity); idSchema.parse(c.conversationId);
    const old = this.entries.get(c.reservationId);
    if (!old || old.userId !== id.userId) this.conflict();
    if (this.binding.has(old.reservationId)) this.conflict();
    if (old.conversationId === c.conversationId) return structuredClone(old);
    if (old.conversationId !== null) throw new AppError('INVALID_REQUEST', 'Conversation binding cannot change.');
    const slot = this.scope(id.userId, c.conversationId);
    if (this.slots.has(slot)) this.conflict();
    this.slots.set(slot, old.reservationId); this.binding.add(old.reservationId);
    try {
      if (await this.busy(id.userId, c.conversationId)) this.conflict();
      const next = { ...old, conversationId: c.conversationId };
      this.entries.set(old.reservationId, next); return structuredClone(next);
    } catch (error) { if (this.slots.get(slot) === old.reservationId) this.slots.delete(slot); throw error; }
    finally { this.binding.delete(old.reservationId); }
  }

  async release(c: Parameters<ExecutionReservationPort['release']>[0]) {
    const id = this.identity(c.identity), old = this.entries.get(c.reservationId);
    if (!old) return;
    if (this.binding.has(old.reservationId)) this.conflict();
    if (old.userId !== id.userId) this.conflict();
    if (old.conversationId !== null && await this.busy(id.userId, old.conversationId)) this.conflict();
    if (this.entries.get(old.reservationId) !== old) this.conflict();
    this.entries.delete(old.reservationId);
    if (old.conversationId !== null) this.slots.delete(this.scope(old.userId, old.conversationId));
  }
}
