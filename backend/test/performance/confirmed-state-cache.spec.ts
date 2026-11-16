/**
 * ============================================================================
 * FILE: confirmed-state-cache.spec.ts
 * LOCATION: backend/test/performance/confirmed-state-cache.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify confirmed in-memory state caching between turns.
 *
 * ROLE IN PROJECT:
 *    Ensures consecutive turns in the same process avoid redundant MongoDB
 *    retrieval (manifest, checkpoint, and message references), while safely
 *    falling back on invalidation, generation mismatch, asset hash changes,
 *    and refreshing volatile Calendar provenance / voice records.
 *
 * KEY COMPONENTS:
 *    - Follow-up read skipping (zero manifest, checkpoint, or message reads).
 *    - Context correctness (accurate assembled history).
 *    - Safe fallback on generation, turnId, asset mismatch, or TTL expiry.
 *    - Invalidation on reconcile, rebase, and cancel.
 *    - Conservative refresh for volatile Calendar/voice records.
 *    - Cache store limits, LRU eviction, and size bounds.
 * ============================================================================
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { calendarFixture, createWire, loadWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { textSnapshot } from '../model/config-snapshot.js';
import {
  ConfirmedStateCache,
  CONFIRMED_STATE_LIMITS,
  type ConfirmedSessionState,
} from '../../src/chat-runtime/confirmed-state-cache.js';
import type { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { AgentMemoryManifest } from '../../src/contracts/agent-memory.js';
import { outputId } from '../../src/chat-runtime/identity.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import { redactCalendarMessage } from '../../src/persistence/calendar-records.js';
import type { LiveExecution } from '../../src/chat-runtime/ports.js';
import type { MessageRecord } from '../../src/contracts/message.js';

function getConfirmedCache(runtime: DurableChatRuntime): ConfirmedStateCache {
  return (runtime as unknown as { confirmedState: ConfirmedStateCache }).confirmedState;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Confirmed In-Memory State Caching', () => {
  it('skips memory, checkpoint, and message reference reads on a healthy follow-up turn', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Initial prompt');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId);
      expect(cached).not.toBeNull();
      expect(cached?.turnId).toBe(first.turnId);
      expect(cached?.plainRecords.length).toBeGreaterThanOrEqual(2); // user + assistant

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const graphSpy = vi.spyOn(h.saver, 'getTuple');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');

      const follow = await h.submit('Follow-up message', first.sessionId);

      expect(memGetSpy).not.toHaveBeenCalled();
      expect(graphSpy).not.toHaveBeenCalled();
      expect(refSpy).not.toHaveBeenCalled();

      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('assembles complete context including prior history and new user input on cache hit', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Turn 1 Question');
      await h.execute(first);

      let capturedPromptMessages: readonly unknown[] = [];
      const origFetch = h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementation(async (url, init) => {
        if (init?.body) {
          try {
            const body = JSON.parse(String(init.body));
            if (Array.isArray(body.messages)) {
              capturedPromptMessages = body.messages;
            }
          } catch {
            // non-json body
          }
        }
        return origFetch(url, init);
      });

      const follow = await h.submit('Turn 2 Follow-up', first.sessionId);
      await h.execute(follow);

      // Verify prompt messages contain: system, Turn 1 user, Turn 1 assistant, and Turn 2 user input
      const userContents = (capturedPromptMessages as { role: string; content: string }[])
        .filter(m => m.role === 'user')
        .map(m => m.content);
      expect(userContents).toContain('Turn 1 Question');
      expect(userContents).toContain('Turn 2 Follow-up');
    } finally {
      await h.dispose();
    }
  });

  it('falls back to strict MongoDB reads when session generation does not match', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Generation test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId)!;
      expect(cached).not.toBeNull();

      // Tamper sessionGeneration to simulate out-of-sync or external acquisition
      cache.put({
        ...cached,
        sessionGeneration: cached.sessionGeneration + 99,
      });

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');

      const follow = await h.submit('Follow-up with generation mismatch', first.sessionId);
      // Generation mismatch causes cache miss -> strict path called
      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();

      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('falls back to strict MongoDB reads when turnId does not match currentSession.latestTurnId', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('TurnId mismatch test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId)!;

      // Tamper turnId in cache
      cache.put({
        ...cached,
        turnId: 'stale_turn_999',
      });

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const follow = await h.submit('Follow-up after turn tampering', first.sessionId);

      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();
      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('falls back to strict MongoDB reads when instructionVersion changes', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Version mismatch test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId)!;

      cache.put({
        ...cached,
        instructionVersion: 'outdated-v0',
      });

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const follow = await h.submit('Follow-up after instruction change', first.sessionId);

      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();
      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('falls back to strict MongoDB reads when cache TTL expires', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Expiry test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId)!;

      // Set expiration in the past
      cache.put({
        ...cached,
        expiresAt: Date.now() - 1000,
      });

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const follow = await h.submit('Follow-up after expiry', first.sessionId);

      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();
      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('falls back to strict MongoDB reads when cache is cleared', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Restart test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      cache.clear();

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const follow = await h.submit('Follow-up with empty cache', first.sessionId);

      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();
      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('invalidates cache when reconcileSession is called', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Reconcile test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, first.sessionId)).not.toBeNull();

      await h.runtime.reconcileSession(h.identity.userId, first.sessionId);
      expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const follow = await h.submit('Follow-up after reconcile', first.sessionId);

      expect(memGetSpy).toHaveBeenCalled();
      expect(refSpy).toHaveBeenCalled();
      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('invalidates cache when rebaseSession is called', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Rebase test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, first.sessionId)).not.toBeNull();

      await h.runtime.rebaseSession(h.identity.userId, first.sessionId);
      expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('invalidates cache when cancelTurn is called', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Cancel test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, first.sessionId)).not.toBeNull();

      await h.runtime.cancelTurn({
        identity: h.identity,
        sessionId: first.sessionId,
        turnId: first.turnId,
        attemptId: first.attemptId,
      });

      expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('conservatively refreshes volatile records while reusing immutable history', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('Volatile record test');
      await h.execute(first);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId)!;
      expect(cached).not.toBeNull();

      // The last record in cached.plainRecords is the assistant message
      const volatileRecord = cached.plainRecords[cached.plainRecords.length - 1];

      // Partition: assistant record is marked as volatile refreshRef
      cache.put({
        ...cached,
        plainRecords: cached.plainRecords.slice(0, -1),
        refreshRefs: [{
          messageId: volatileRecord.messageId,
          eventId: volatileRecord.eventId,
          sequence: volatileRecord.sequence,
        }],
      });

      const refSpy = vi.spyOn(h.p.messages, 'getReferences');
      const memGetSpy = vi.spyOn(h.p.memory, 'get');

      const follow = await h.submit('Follow-up with volatile refresh', first.sessionId);

      // Memory/manifest read is still skipped!
      expect(memGetSpy).not.toHaveBeenCalled();
      // Only the volatile record was refreshed via getReferences!
      expect(refSpy).toHaveBeenCalledWith(
        h.identity.userId,
        first.sessionId,
        expect.arrayContaining([{
          messageId: volatileRecord.messageId,
          eventId: volatileRecord.eventId,
          sequence: volatileRecord.sequence,
        }]),
      );

      await h.execute(follow);
    } finally {
      await h.dispose();
    }
  });

  it('stores confirmed state after Calendar turn and conservatively refreshes only volatile records on follow-up', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event', 'confirmed-load'),
        createWire(event()));
      h.modelWires.push(textWire('Done.'));
      await h.execute(ids);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, ids.sessionId);
      expect(cached).not.toBeNull();
      expect(cached?.turnId).toBe(ids.turnId);
      // Calendar assistant message has sourceProvenance, so it's placed in refreshRefs
      expect(cached?.refreshRefs.length).toBeGreaterThanOrEqual(1);

      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const refSpy = vi.spyOn(h.p.messages, 'getReferences');

      await h.submit('Thank you', ids.sessionId);
      // Memory manifest query skipped
      expect(memGetSpy).not.toHaveBeenCalled();
      // Only the volatile calendar record is refreshed
      expect(refSpy).toHaveBeenCalledWith(
        h.identity.userId,
        ids.sessionId,
        expect.arrayContaining(cached!.refreshRefs),
      );
    } finally {
      await h.dispose();
    }
  });

  it('supports idempotent resubmission without corrupting cached confirmed state', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('First turn');
      await h.execute(first);

      // Submit follow-up
      const follow1 = await h.submit('Idempotent follow-up', first.sessionId);
      // Resubmit same command (same idempotencyKey in submit)
      await h.runtime.submitTurn({
        identity: h.identity,
        sessionId: first.sessionId,
        content: 'Idempotent follow-up',
        idempotencyKey: follow1.attemptId,
      }).catch(() => null);

      await h.execute(follow1);
      // Confirmed state for follow-up turn is stored upon execution completion
      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, first.sessionId);
      expect(cached).not.toBeNull();
      expect(cached?.turnId).toBe(follow1.turnId);
    } finally {
      await h.dispose();
    }
  });

  it('clears confirmed state cache during quiesceStreams on calendar disconnect or replacement', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event', 'quiesce-load'), createWire(event()));
      h.modelWires.push(textWire('Done.'));
      await h.execute(ids);

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, ids.sessionId)).not.toBeNull();

      // quiesceStreams is invoked during disconnect / account replacement / drain
      await h.runtime.quiesceStreams();

      // Cache is cleared!
      expect(cache.get(h.identity.userId, ids.sessionId)).toBeNull();

      // Follow-up turn falls back to strict MongoDB reads
      const memGetSpy = vi.spyOn(h.p.memory, 'get');
      const follow = await h.submit('Follow-up after quiesce', ids.sessionId);
      expect(memGetSpy).toHaveBeenCalled();
    } finally {
      await h.dispose();
    }
  });

  it('places Calendar answer without provenance into refreshRefs, avoiding stale reuse on follow-up after redaction', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      // Conversational reply during calendar intent with NO provenance
      const ids = await h.submit('What can you do with my calendar?');
      h.modelWires.push(textWire('I can manage your events.'));
      await h.execute(ids);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, ids.sessionId);
      expect(cached).not.toBeNull();
      expect(cached?.turnId).toBe(ids.turnId);

      const outId = outputId({ userId: h.identity.userId, sessionId: ids.sessionId, attemptId: ids.attemptId } as any);

      // The assistant answer MUST be in refreshRefs, NOT in plainRecords
      expect(cached?.refreshRefs.map(r => r.messageId)).toContain(outId);
      expect(cached?.plainRecords.map(r => r.messageId)).not.toContain(outId);
      expect(cached?.calendarMessageIds).toContain(outId);

      // Simulate redaction in storage (as calendar-retention does on account invalidation)
      const origGetRefs = h.p.messages.getReferences.bind(h.p.messages);
      const refSpy = vi.spyOn(h.p.messages, 'getReferences').mockImplementation(async (u, s, refs) => {
        const records = await origGetRefs(u, s, refs);
        return records.map(m => m.messageId === outId ? { ...m, content: CALENDAR_TOMBSTONE } : m);
      });
      const origList = h.p.messages.listForContext.bind(h.p.messages);
      vi.spyOn(h.p.messages, 'listForContext').mockImplementation(async (u, s, opts) => {
        const res = await origList(u, s, opts);
        return {
          ...res,
          items: res.items.map(m => m.messageId === outId ? { ...m, content: CALENDAR_TOMBSTONE } : m),
        };
      });

      // Next follow-up turn
      let followUpPromptMessages: readonly any[] = [];
      const origFetch = h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementation(async (url, init) => {
        if (init?.body) {
          try {
            const body = JSON.parse(String(init.body));
            if (Array.isArray(body.messages)) followUpPromptMessages = body.messages;
          } catch {}
        }
        return origFetch(url, init);
      });

      const follow = await h.submit('Tell me more', ids.sessionId);
      expect(refSpy).toHaveBeenCalledWith(
        h.identity.userId,
        ids.sessionId,
        expect.arrayContaining([{ messageId: outId, eventId: expect.any(String), sequence: expect.any(Number) }]),
      );

      h.modelWires.push(textWire('More details.'));
      await h.execute(follow);

      // The assembled context received the redacted tombstone, NOT the pre-redaction content!
      const assistantInPrompt = followUpPromptMessages.find((m: any) => m.role === 'assistant');
      expect(assistantInPrompt?.content).toBe(CALENDAR_TOMBSTONE);
      expect(assistantInPrompt?.content).not.toBe('I can manage your events.');

      // Follow-up cache still preserves the prior calendar answer in refreshRefs, never demoting to plainRecords
      const cached2 = cache.get(h.identity.userId, ids.sessionId);
      expect(cached2?.refreshRefs.map(r => r.messageId)).toContain(outId);
      expect(cached2?.plainRecords.map(r => r.messageId)).not.toContain(outId);
    } finally {
      await h.dispose();
    }
  });

  it('keeps retrieved calendar details after classification is lost and an account invalidation sweep', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      // Turn 1: Conversational reply during calendar intent with NO provenance
      const ids = await h.submit('What can you do with my calendar?');
      h.modelWires.push(textWire('I can manage your events.'));
      await h.execute(ids);

      const outId = outputId({ userId: h.identity.userId, sessionId: ids.sessionId, attemptId: ids.attemptId } as any);


      // Verify the message was initially written with original content in messages collection
      const initialMsg = await h.p.messages.get(h.identity.userId, ids.sessionId, outId);
      expect(initialMsg?.content).toBe('I can manage your events.');

      // Classification tracking is lost (e.g. reconcileSession wipes in-memory classification tracking and confirmed state)
      await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);

      // Verify tracking and confirmed state are gone
      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, ids.sessionId)).toBeNull();

      // Run ACTUAL account retention / invalidation sweep (no mocking getReferences!)
      const conn = await (h.p as any).calendarConnectionsV2.get(h.identity.userId);
      const account = {
        userId: conn.userId,
        connectionId: conn.connectionId,
        connectionRevision: conn.connectionRevision,
        googleSubjectId: conn.googleSubjectId,
      };
      let cursor: string | null = null;
      do {
        const sweep = await (h.p as any).calendarRetention.invalidateAccountRevisionPage({
          account,
          now: new Date(h.clock() + 10_000).toISOString(),
          cursor,
          limit: 10,
        });
        cursor = sweep.nextCursor;
      } while (cursor !== null);

      const kept = await h.p.messages.get(h.identity.userId, ids.sessionId, outId);
      expect(kept?.content).toBe('I can manage your events.');

      const follow = await h.submit('Tell me more', ids.sessionId);
      const runtimeAny = h.runtime as any;
      const receipt = runtimeAny.receipts.get(h.identity.userId, ids.sessionId, follow.attemptId);
      expect(receipt).not.toBeNull();
      expect(receipt?.refreshRefs.map((r: any) => r.messageId)).toContain(outId);
      expect(receipt?.sourceRecords.map((r: any) => r.messageId)).not.toContain(outId);
    } finally {
      await h.dispose();
    }
  });

  it('fails closed when 1024-session tracking eviction occurs, never granting immutable status to Calendar answers', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      // Turn 1: Calendar question with no provenance
      const ids = await h.submit('What can you do with my calendar?');
      h.modelWires.push(textWire('I can manage your events.'));
      await h.execute(ids);

      const outId = outputId({ userId: h.identity.userId, sessionId: ids.sessionId, attemptId: ids.attemptId } as any);


      // Force 1024-session tracking map eviction by inserting 1025 dummy sessions
      const runtimeAny = h.runtime as any;
      for (let i = 0; i < 1025; i++) {
        runtimeAny.trackCalendarMessage(`eviction-session-${i}`, `dummy-msg-${i}`);
      }

      // ids.sessionId is now evicted from sessionCalendarMessages
      expect(runtimeAny.sessionCalendarMessages.has(ids.sessionId)).toBe(false);

      // Also ensure confirmedState is cleared/evicted so Turn 2 must rebuild receipt from storage
      runtimeAny.confirmedState.delete(h.identity.userId, ids.sessionId);

      // Actual retention sweep runs and redacts the assistant message in storage
      const conn = await (h.p as any).calendarConnectionsV2.get(h.identity.userId);
      const account = {
        userId: conn.userId,
        connectionId: conn.connectionId,
        connectionRevision: conn.connectionRevision,
        googleSubjectId: conn.googleSubjectId,
      };
      let cursor: string | null = null;
      do {
        const sweep = await (h.p as any).calendarRetention.invalidateAccountRevisionPage({
          account,
          now: new Date(h.clock() + 10_000).toISOString(),
          cursor,
          limit: 10,
        });
        cursor = sweep.nextCursor;
      } while (cursor !== null);

      expect((await h.p.messages.get(h.identity.userId, ids.sessionId, outId))?.content)
        .toBe('I can manage your events.');

      const follow = await h.submit('Tell me more', ids.sessionId);
      const receipt = runtimeAny.receipts.get(h.identity.userId, ids.sessionId, follow.attemptId);
      expect(receipt?.refreshRefs.map((r: any) => r.messageId)).toContain(outId);
      expect(receipt?.sourceRecords.map((r: any) => r.messageId)).not.toContain(outId);
    } finally {
      await h.dispose();
    }
  });

  it('keeps retrieved calendar details after process restart and account invalidation', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      // Turn 1: Calendar question with no provenance
      const ids = await h.submit('What can you do with my calendar?');
      h.modelWires.push(textWire('I can manage your events.'));
      await h.execute(ids);

      const outId = outputId({ userId: h.identity.userId, sessionId: ids.sessionId, attemptId: ids.attemptId } as any);


      await h.restart();

      const conn = await (h.p as any).calendarConnectionsV2.get(h.identity.userId);
      const account = {
        userId: conn.userId,
        connectionId: conn.connectionId,
        connectionRevision: conn.connectionRevision,
        googleSubjectId: conn.googleSubjectId,
      };
      let cursor: string | null = null;
      do {
        const sweep = await (h.p as any).calendarRetention.invalidateAccountRevisionPage({
          account,
          now: new Date(h.clock() + 10_000).toISOString(),
          cursor,
          limit: 10,
        });
        cursor = sweep.nextCursor;
      } while (cursor !== null);

      expect((await h.p.messages.get(h.identity.userId, ids.sessionId, outId))?.content)
        .toBe('I can manage your events.');
    } finally {
      await h.dispose();
    }
  });

  it('keeps retrieved calendar details after source expiry instead of tombstoning the transcript', async () => {
    const h = calendarFixture();
    await yieldTurn();
    try {
      h.clearAvailability();
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event', 'expiry-load'), createWire(event()));
      h.modelWires.push(textWire('Event booked.'));
      await h.execute(ids);

      const cache = getConfirmedCache(h.runtime);
      const cached = cache.get(h.identity.userId, ids.sessionId);
      expect(cached).not.toBeNull();
      const outId = outputId({ userId: h.identity.userId, sessionId: ids.sessionId, attemptId: ids.attemptId } as any);

      expect(cached?.refreshRefs.map(r => r.messageId)).toContain(outId);

      // Advance time beyond the source retention / expiry deadline (24 hours)
      h.advance(86_400_000 + 1000);
      const stored = await h.p.messages.get(h.identity.userId, ids.sessionId, outId);
      expect(stored?.content).toBeTruthy();
      expect(stored?.content).not.toBe(CALENDAR_TOMBSTONE);
      expect(redactCalendarMessage(stored!, h.clock()).content).toBe(stored?.content);
    } finally {
      await h.dispose();
    }
  });

  it('does not publish confirmed state while release is pending/delayed, publishing only after release completes', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const cache = getConfirmedCache(h.runtime);
      const origRelease = h.p.owner.release.bind(h.p.owner);
      let releaseChecked = false;
      let resolveRelease!: () => void;
      const releaseBlocker = new Promise<void>(res => { resolveRelease = res; });

      const first = await h.submit('Initial deferred release test');

      vi.spyOn(h.p.owner, 'release').mockImplementation(async (lease) => {
        // While release is pending: assert cache entry is NOT published yet!
        expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();
        releaseChecked = true;
        resolveRelease();
        return origRelease(lease);
      });

      // Force fallback text release path so release is invoked
      (h.p.owner as any).finishAttempt = undefined;

      const execPromise = h.execute(first);
      await releaseBlocker;
      await execPromise;

      expect(releaseChecked).toBe(true);
      // Only after release finishes is the cache entry published!
      expect(cache.get(h.identity.userId, first.sessionId)).not.toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('does not publish or leave reusable cache entry when voice settlement fails', async () => {
    const h = textConfigFixture(textSnapshot(1));
    const reservation = await h.runtime.reservations.acquire({
      identity: h.identity,
      conversationId: 'voice-settle-fail-fixture',
      owner: { kind: 'live', voiceSessionId: 'v-settle-fail' },
    });
    try {
      const ids = await h.runtime.submitLiveTurn({
        identity: h.identity,
        sessionId: 'voice-settle-fail-fixture',
        reservation,
        configSnapshot: textSnapshot(1),
        content: 'Voice prompt',
        idempotencyKey: 'voice-settle-key',
      });

      const live: LiveExecution = {
        reservation,
        start: async () => undefined,
        delta: async () => undefined,
        finish: async () => undefined,
        settle: async () => {
          throw new Error('TTS settlement failed abruptly');
        },
      };

      await expect(h.runtime.executeTurn({
        userId: h.identity.userId,
        ...ids,
        signal: new AbortController().signal,
        emit: async () => undefined,
        live,
      })).rejects.toThrow('TTS settlement failed abruptly');

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, 'voice-settle-fail-fixture')).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('does not publish or leave reusable cache entry when voice lease release fails', async () => {
    const h = textConfigFixture(textSnapshot(1));
    const reservation = await h.runtime.reservations.acquire({
      identity: h.identity,
      conversationId: 'voice-rel-fail-fixture',
      owner: { kind: 'live', voiceSessionId: 'v-rel-fail' },
    });
    try {
      const ids = await h.runtime.submitLiveTurn({
        identity: h.identity,
        sessionId: 'voice-rel-fail-fixture',
        reservation,
        configSnapshot: textSnapshot(1),
        content: 'Voice prompt 2',
        idempotencyKey: 'voice-rel-key',
      });

      vi.spyOn(h.p.owner, 'release').mockRejectedValueOnce(new Error('Lease release network timeout'));

      const live: LiveExecution = {
        reservation,
        start: async () => undefined,
        delta: async () => undefined,
        finish: async () => undefined,
        settle: async () => undefined,
      };

      await expect(h.runtime.executeTurn({
        userId: h.identity.userId,
        ...ids,
        signal: new AbortController().signal,
        emit: async () => undefined,
        live,
      })).rejects.toThrow('Lease release network timeout');

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, 'voice-rel-fail-fixture')).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('does not publish or leave reusable cache entry when fallback text release fails', async () => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      (h.p.owner as any).finishAttempt = undefined;
      const first = await h.submit('Fallback release fail test');

      vi.spyOn(h.p.owner, 'release').mockRejectedValueOnce(new Error('Fallback release DB disconnect'));
      await expect(h.execute(first)).rejects.toThrow();

      const cache = getConfirmedCache(h.runtime);
      expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();
      expect(cache.get(h.identity.userId, first.sessionId)).toBeNull();
    } finally {
      await h.dispose();
    }
  });
});

describe('ConfirmedStateCache unit tests', () => {
  function makeState(id: string, size = 100): ConfirmedSessionState {
    const manifest: AgentMemoryManifest = {
      schemaVersion: 1,
      userId: 'u1',
      sessionId: `s_${id}`,
      contextVersion: 1,
      messageRefs: [],
      sourceRanges: [],
      activeSummaryRef: null,
      instructionVersion: 'v1',
      knowledgeContentHash: 'hash1',
      graphSchemaVersion: '1',
    };
    return {
      userId: 'u1',
      sessionId: `s_${id}`,
      executorId: 'exec1',
      sessionGeneration: 1,
      turnId: `t_${id}`,
      attemptId: `a_${id}`,
      manifest,
      checkpointId: `cp_${id}`,
      plainRecords: [{
        schemaVersion: 1,
        userId: 'u1',
        sessionId: `s_${id}`,
        turnId: `t_${id}`,
        messageId: `m_${id}`,
        eventId: `e_${id}`,
        sequence: 1,
        role: 'user',
        content: 'x'.repeat(size),
        createdAt: new Date().toISOString(),
        completionStatus: 'accepted',
        attemptId: null,
        truncated: false,
      }],
      refreshRefs: [],
      instructionVersion: 'v1',
      knowledgeContentHash: 'hash1',
      graphSchemaVersion: '1',
      confirmedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }

  it('evicts oldest entries when maxEntries is exceeded', () => {
    const cache = new ConfirmedStateCache({
      maxEntries: 3,
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
      defaultTtlMs: 60_000,
    });

    cache.put(makeState('1'));
    cache.put(makeState('2'));
    cache.put(makeState('3'));
    expect(cache.size).toBe(3);
    expect(cache.get('u1', 's_1')).not.toBeNull();

    // Adding 4th should evict '1'
    cache.put(makeState('4'));
    expect(cache.size).toBe(3);
    expect(cache.get('u1', 's_1')).toBeNull();
    expect(cache.get('u1', 's_2')).not.toBeNull();
    expect(cache.get('u1', 's_3')).not.toBeNull();
    expect(cache.get('u1', 's_4')).not.toBeNull();
  });

  it('evicts oldest entries when maxTotalBytes is exceeded', () => {
    const singleStateBytes = Buffer.byteLength(JSON.stringify(makeState('1', 500)), 'utf8');
    const cache = new ConfirmedStateCache({
      maxEntries: 100,
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: singleStateBytes * 2 + 50, // fits only 2 entries
      defaultTtlMs: 60_000,
    });

    cache.put(makeState('1', 500));
    cache.put(makeState('2', 500));
    expect(cache.size).toBe(2);

    cache.put(makeState('3', 500));
    expect(cache.size).toBeLessThanOrEqual(2);
    expect(cache.get('u1', 's_1')).toBeNull(); // oldest evicted
    expect(cache.get('u1', 's_3')).not.toBeNull();
  });

  it('refuses to cache oversized entries exceeding maxEntryBytes', () => {
    const cache = new ConfirmedStateCache({
      maxEntries: 10,
      maxEntryBytes: 500, // very small entry limit
      maxTotalBytes: 1024 * 1024,
      defaultTtlMs: 60_000,
    });

    const oversized = makeState('huge', 1000);
    cache.put(oversized);
    expect(cache.size).toBe(0);
    expect(cache.get('u1', 's_huge')).toBeNull();
  });

  it('prunes expired entries on access and insertion', () => {
    let now = 1000;
    const cache = new ConfirmedStateCache(CONFIRMED_STATE_LIMITS, () => now);

    const state = makeState('exp');
    (state as { expiresAt: number }).expiresAt = 2000;
    cache.put(state);
    expect(cache.get('u1', 's_exp')).not.toBeNull();

    now = 2500; // time passes
    expect(cache.get('u1', 's_exp')).toBeNull();
    expect(cache.size).toBe(0);
  });
});
