/**
 * ============================================================================
 * FILE: native-latency.e2e-spec.ts
 * LOCATION: backend/test/performance/native-latency.e2e-spec.ts
 * PURPOSE: Prepare bounded real-storage baseline/current latency measurements.
 * ROLE IN PROJECT: Explicit authorization only; scripted external transports;
 *    no saver facade activation, synthetic latency substitution or conformance claim.
 * KEY COMPONENTS: Six matched scenarios, complete command totals and milestones.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { authorizeNative, NATIVE_LATENCY_SCENARIOS } from './native-safety.js';
import { nativeLatencyFixture } from './native-runtime.js';

// Disabled means no URI access, client creation, topology discovery, or DB work.
const enabled = process.env.AURVIN_NATIVE_PERF_ENABLE === 'authorized';

describe.skipIf(!enabled)('isolated native latency (not saver conformance)', () => {
  for (const scenario of NATIVE_LATENCY_SCENARIOS) {
    it(scenario.name, async () => {
      const authorization = authorizeNative(process.env);
      for (let sample = 1; sample <= authorization.samples; sample++) {
        const fx = await nativeLatencyFixture(scenario.path);
        try {
          let sessionId: string | null = null;
          for (let i = 1; i <= scenario.prior; i++) {
            const ids = await fx.fixture.submit(`Prior question ${i}`, sessionId);
            sessionId = ids.sessionId;
            await fx.execute(ids);
          }
          if (scenario.name === 'calendar-text') fx.calendar!.modelWires.push(textWire('Your schedule is clear today.'));
          if (scenario.name === 'calendar-read') {
            fx.calendar!.modelWires.push(nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_read_1', type: 'function',
              function: { name: 'calendar_get_event', arguments: JSON.stringify({ calendarId: 'personal@example.test', eventId: 'evt_100' }) },
            }] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n', textWire('The Planning event is from 10:00 to 11:00 UTC.'));
          }
          if (scenario.name === 'calendar-create') fx.calendar!.modelWires.push(createWire({ summary: 'Planning',
            start: '2026-11-03T10:00:00+00:00', end: '2026-11-03T11:00:00+00:00', timeZone: 'Etc/UTC' }, 'create-one'),
          textWire('I scheduled Planning on Work from 10:00 to 11:00 Etc/UTC.'));
          const prompt = scenario.name === 'calendar-create'
            ? 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.'
            : scenario.name === 'calendar-read' ? 'Show event evt_100 on my Personal calendar.'
              : scenario.name === 'calendar-text' ? 'How does my day look?' : 'Hello';
          const { result: ids, metrics } = await fx.measure(async () => {
            const ids = await fx.fixture.submit(prompt, sessionId);
            await fx.execute(ids);
            return ids;
          });
          // Emit measurements before assertions: correctness failures must not hide evidence.
          console.log(JSON.stringify({ kind: 'native-latency', scenario: scenario.name, sample,
            generatedDatabase: fx.database.name, provenance: fx.database.provenance, saverFacade: 'default-disabled', metrics }));
          expect(metrics.total).toBeGreaterThan(0);
          expect(Object.values(metrics.commands).reduce((n, count) => n + count, 0)).toBe(metrics.total);
          expect(metrics).toMatchObject({ pending: 0, unmatched: 0, failed: 0, nonMajorityWrites: 0 });
          for (const boundary of ['dispatch', 'firstAnswer', 'seal', 'release', 'terminal', 'settled']) {
            expect(metrics.milestones[boundary], boundary).toBeGreaterThanOrEqual(0);
          }
          expect(metrics.milestones.dispatch).toBeLessThanOrEqual(metrics.milestones.firstAnswer!);
          expect(metrics.milestones.seal).toBeLessThanOrEqual(metrics.milestones.terminal!);
          expect(metrics.milestones.release).toBeLessThanOrEqual(metrics.milestones.terminal!);
          expect(fx.fixture.runtime.snapshot()).toMatchObject({ active: 0, unresolvedWrites: 0, degraded: false });
          expect(fx.frames.filter(frame => frame.event.type === 'completed')).toHaveLength(1);
          const attempt = await fx.persistence.metadata.getAttempt(fx.fixture.identity.userId, ids.sessionId, ids.attemptId);
          expect(attempt?.status).toBe('completed');
          expect(await fx.persistence.metadata.getAccounting(fx.fixture.identity.userId, ids.sessionId, ids.attemptId)).not.toBeNull();
          const session = await fx.persistence.sessions.get(fx.fixture.identity.userId, ids.sessionId);
          expect(session?.execution).toMatchObject({ ownerId: null, activeAttemptId: null });
          for (const body of fx.modelBodies) {
            expect(body.user).toBe(fx.fixture.identity.userId);
            const messages = body.messages as Array<{ role: string; content?: string }>;
            expect(messages.filter(message => message.role === 'user' && message.content === prompt)).toHaveLength(1);
          }
          expect(fx.modelBodies.length).toBeGreaterThan(0);
          expect(fx.calendar?.effects.filter(effect => effect.kind === 'create').length ?? 0).toBe(scenario.name === 'calendar-create' ? 1 : 0);
          if (scenario.name === 'calendar-read') expect(fx.calendar!.effects.filter(effect => effect.kind === 'get')).toHaveLength(1);
          expect((await fx.readyAfterCleanup()).acceptReady).toBe(true);
        } finally { await fx.close(); }
      }
    }, 300_000);
  }
});
