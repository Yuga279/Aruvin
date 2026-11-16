/**
 * ============================================================================
 * FILE: calendar-live.fixture.ts
 * LOCATION: backend/test/runtime/calendar-live.fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assemble deterministic live runtime fixtures over existing offline stores.
 *
 * ROLE IN PROJECT:
 *    Provides genuine reservations, unknown-hearing delivery settlement, and
 *    recording frame sinks for memory/durable voice unit coverage. It is not
 *    P3's transport integration fixture.
 *
 * KEY COMPONENTS:
 *    - calendarLiveFixture: Memory or durable live harness with submit/execute.
 *    - Recording sink: Captures presentation frames without transport.
 * ============================================================================
 */

import { vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import { calendarFixture, type CalendarRuntimeFixture } from './calendar-runtime.fixture.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import type { CalendarCompatibleEnvelope, DeliveryWrite, LiveExecution } from '../../src/chat-runtime/ports.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
import { key } from '../../src/persistence/records.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../../src/contracts/voice.js';

export async function calendarLiveFixture(mode: 'memory' | 'durable') {
  let h: CalendarRuntimeFixture;
  if (mode === 'memory') {
    const db = calendarMemory();
    const client = Object.assign(db.commandSource, { db: () => db.store.db, appendMetadata: () => undefined }) as unknown as MongoClient;
    const p = await createPersistenceBundle(client, 'offline-calendar-voice-unit', DEFAULT_BUDGETS, 'offline-calendar-voice-executor');
    h = calendarFixture(undefined, p, { policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1,
      shutdownDrainMs: 50 }, voice: true });
  } else h = calendarFixture();
  await h.ready;
  const firstKey = 'calendar-live-input-0001';
  const sessionId = sessionIdFor(h.identity.userId, null, firstKey);
  const voiceSessionId = 'calendar-voice-unit';
  const acquired = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: null,
    owner: { kind: 'live', voiceSessionId } });
  const reservation = await h.runtime.reservations.bindConversation({ identity: h.identity,
    reservationId: acquired.reservationId, conversationId: sessionId });
  let serial = 0;
  const frames: CalendarCompatibleEnvelope[] = [];
  const spoken: string[] = [];
  const finish = vi.fn(async () => undefined);
  const submit = (content: string, calendarReplyTo?: { proposalId: string; revision: number }) => {
    const n = ++serial;
    return h.runtime.submitLiveTurn({ identity: h.identity, sessionId, content, reservation,
      idempotencyKey: n === 1 ? firstKey : `calendar-live-input-${n}`,
      freshConversation: n === 1, configSnapshot: h.currentConfig.current()!,
      voice: { voiceSessionId, socketEpoch: 1, providerTurnId: `input-${n}` },
      ...(calendarReplyTo ? { calendarReplyTo } : {}) });
  };
  const execute = async (ids: Awaited<ReturnType<typeof submit>>,
    sink: (frame: CalendarCompatibleEnvelope) => Promise<void> = async frame => { frames.push(frame); }) => {
    let write!: DeliveryWrite, record!: VoiceDeliveryRecord;
    const live: LiveExecution = { reservation,
      start: async (a, save) => {
        write = save;
        record = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: a.userId,
          sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId, voiceSessionId,
          responseId: key('voice-response', a.userId, a.sessionId, a.attemptId), status: 'pending',
          textGenerated: '', createdAt: a.createdAt, updatedAt: a.createdAt });
        await write(record);
      },
      delta: async text => { spoken.push(text); }, finish,
      artifact: async artifact => {
        const old = record.sequence;
        record = voiceDeliveryRecordSchema.parse({ ...record, sequence: old + 1,
          canvasArtifacts: [...record.canvasArtifacts ?? [], artifact] });
        await write(record, old); return true;
      },
      settle: async textGenerated => {
        const old = record.sequence;
        record = voiceDeliveryRecordSchema.parse({ ...record, sequence: old + 1,
          status: 'unknown', textGenerated }); // fixture does not assert human hearing
        await write(record, old);
      },
    };
    await h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, emitCalendar: sink, live });
  };
  const dispose = async () => {
    await h.runtime.reservations.release({ identity: h.identity, reservationId: reservation.reservationId });
    await h.dispose();
  };
  return { h, sessionId, reservation, frames, spoken, finish, submit, execute, dispose };
}
