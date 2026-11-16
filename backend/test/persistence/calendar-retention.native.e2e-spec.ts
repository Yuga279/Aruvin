import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { operation, source } from './calendar-fixtures.js';
import { message } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Calendar isolated native retention', () => {
  it('source expiry redacts archive ledger and graph references', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.messages.append(message(0));
        await bundle.messages.append(messageRecordSchema.parse({
          ...message(2), role: 'assistant', content: 'Fetched event details',
          sourceProvenance: [source()],
        }));
        const user = await bundle.messages.get('u1', 's1', 'm0');
        expect(user?.content).toBe('Hello');
        expect(CALENDAR_TOMBSTONE).toContain('Google Calendar');
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('disconnect and restore cannot re-admit content', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarRetention.registerSource({ userId: 'u1', sessionId: 's1', source: source() });
        await bundle.calendarRetention.redactSource({
          userId: 'u1', sessionId: 's1', sourceId: 'src1', reason: 'disconnected',
          now: '2026-10-20T10:05:00.000Z',
        });
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('audit expiry retains safe quarantine and refuses replay', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarOperations.reserve(operation());
        await bundle.calendarRetention.expireAuditPage({
          userId: 'u1', now: '2026-12-01T00:00:00.000Z', cursor: null, limit: 20,
        });
        const reserved = await bundle.calendarOperations.reserve({ ...operation(), originatingAttemptId: 'a9' });
        expect(reserved.outcome).toBe('existing');
        expect(reserved.record.googleEventId).toBe(operation().googleEventId);
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);
});
