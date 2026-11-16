/**
 * ============================================================================
 * FILE: submission-recovery.test.ts
 * LOCATION: frontend/src/api/submission-recovery.test.ts
 * PURPOSE: Verify retained submission identity across ambiguous delivery and reload.
 * ROLE IN PROJECT: Deterministic browser-storage/fetch checks without trusted history.
 * KEY COMPONENTS: Stable payload, process epoch, explicit new attempt and bounds.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { ApiClient } from './client.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const input = { sessionId: null, content: 'Keep my original input', idempotencyKey: 'original-request', expectedEpoch: 'process-one' };
const accepted = { sessionId: 'session-one', turnId: 'turn-one', attemptId: 'attempt-one', userMessageId: 'message-one',
  streamPath: '/sessions/session-one/turns/turn-one/stream', processEpoch: 'process-one' };

it('reuses the original key and payload after ambiguous delivery and a browser client reload', async () => {
  const recoveryStorage = storage(), fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost response'));
  const first = new ApiClient({ fetch: fetcher, recoveryStorage });
  await expect(first.submitTurn(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(first.submissionRecovery).toEqual(input);
  const second = new ApiClient({ fetch: fetcher, recoveryStorage });
  fetcher.mockResolvedValueOnce(Response.json(accepted));
  await second.submitTurn({ ...input, idempotencyKey: 'replacement-request' });
  expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
  expect(second.submissionRecovery).toBeNull();
  fetcher.mockResolvedValueOnce(Response.json(accepted));
  await second.submitTurn({ sessionId: 'session-one', content: 'Next', idempotencyKey: 'next-request' });
  expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string).expectedEpoch).toBe('process-one');
});

it('blocks changed ambiguous payload and epochless replay until an explicit new attempt', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('lost response'));
  const client = new ApiClient({ fetch: fetcher, recoveryStorage: storage() });
  const { expectedEpoch: _epoch, ...epochless } = input;
  await expect(client.submitTurn(epochless)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await expect(client.submitTurn({ ...epochless, content: 'Changed' })).rejects.toMatchObject({ code: 'SUBMISSION_PENDING' });
  await expect(client.submitTurn(epochless)).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
  expect(fetcher).toHaveBeenCalledOnce();
  client.discardSubmissionRecovery();
  fetcher.mockResolvedValueOnce(Response.json(accepted));
  await client.submitTurn({ ...epochless, idempotencyKey: 'explicit-new-request' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('retains old-process unknown outcomes and rejects malformed restored records', async () => {
  const recoveryStorage = storage(), fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ code: 'INTERRUPTED', message: 'Outcome unknown', retryable: false }, { status: 409 }));
  const client = new ApiClient({ fetch: fetcher, recoveryStorage });
  await expect(client.submitTurn(input)).rejects.toMatchObject({ code: 'INTERRUPTED' });
  expect(new ApiClient({ fetch: fetcher, recoveryStorage }).submissionRecovery).toEqual(input);
  recoveryStorage.setItem('aurvin:submission:v1:/api', JSON.stringify({ pending: { ...input, userId: 'forged' }, epoch: 'process-one' }));
  expect(new ApiClient({ fetch: fetcher, recoveryStorage }).submissionRecovery).toBeNull();
});

it('reuses original retryTurn key and expectedEpoch across transport ambiguity and client reload', async () => {
  const recoveryStorage = storage();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(accepted))
    .mockRejectedValueOnce(new Error('lost retry response'));
  const first = new ApiClient({ fetch: fetcher, recoveryStorage });
  await first.submitTurn(input);

  await expect(
    first.retryTurn('session-one', 'turn-one', { idempotencyKey: 'retry-key-original', calendarProtocol: 2 }),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(first.retryRecovery).toEqual({
    sessionId: 'session-one',
    turnId: 'turn-one',
    request: { idempotencyKey: 'retry-key-original', calendarProtocol: 2, expectedEpoch: 'process-one' },
  });

  // Save-only retry must never reset or clear pending generation-retry recovery.
  fetcher.mockResolvedValueOnce(
    Response.json({
      sessionId: 'session-one',
      turnId: 'turn-one',
      attemptId: 'attempt-one',
      status: 'failed',
      truncated: false,
      error: null,
      save: { state: 'saved', epoch: 'process-one', version: 1, durableVersion: 1 },
    }),
  );
  await first.retrySave('session-one', 'turn-one', { epoch: 'process-one', version: 1 });
  expect(first.retryRecovery?.request.idempotencyKey).toBe('retry-key-original');

  // Reloaded client blocks conflicting submit or different-turn retry, then replays exact original retry payload.
  const second = new ApiClient({ fetch: fetcher, recoveryStorage });
  expect(second.retryRecovery).toEqual(first.retryRecovery);
  await expect(
    second.submitTurn({ sessionId: 'session-one', content: 'Conflicting new turn', idempotencyKey: 'conflict-submit-key' }),
  ).rejects.toMatchObject({ code: 'SUBMISSION_PENDING' });
  await expect(
    second.retryTurn('session-one', 'turn-two', { idempotencyKey: 'conflict-retry-key', calendarProtocol: 2 }),
  ).rejects.toMatchObject({ code: 'SUBMISSION_PENDING' });

  fetcher.mockResolvedValueOnce(
    Response.json({ ...accepted, attemptId: 'attempt-two', processEpoch: 'process-one' }),
  );
  await second.retryTurn('session-one', 'turn-one', { idempotencyKey: 'replacement-retry-key', calendarProtocol: 2 });
  expect(fetcher.mock.calls[3][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  expect(JSON.parse(fetcher.mock.calls[3][1]?.body as string)).toEqual({
    idempotencyKey: 'retry-key-original',
    calendarProtocol: 2,
    expectedEpoch: 'process-one',
  });
  expect(second.retryRecovery).toBeNull();
});

it('blocks epochless retry replay, retains INTERRUPTED after restart, and rejects malformed retry records', async () => {
  const recoveryStorage = storage();
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost epochless retry'));
  const epochlessClient = new ApiClient({ fetch: fetcher, recoveryStorage });
  await expect(
    epochlessClient.retryTurn('session-one', 'turn-one', { idempotencyKey: 'epochless-retry-key' }),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await expect(
    epochlessClient.retryTurn('session-one', 'turn-one', { idempotencyKey: 'epochless-retry-key-2' }),
  ).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });
  expect(fetcher).toHaveBeenCalledOnce();

  epochlessClient.discardSubmissionRecovery();
  expect(epochlessClient.retryRecovery).toBeNull();

  fetcher.mockResolvedValueOnce(
    Response.json({ code: 'INTERRUPTED', message: 'Restarted', retryable: false }, { status: 409 }),
  );
  await expect(
    epochlessClient.retryTurn('session-one', 'turn-one', {
      idempotencyKey: 'restart-retry-key',
      expectedEpoch: 'old-epoch',
    }),
  ).rejects.toMatchObject({ code: 'INTERRUPTED' });
  expect(new ApiClient({ fetch: fetcher, recoveryStorage }).retryRecovery).toEqual({
    sessionId: 'session-one',
    turnId: 'turn-one',
    request: { idempotencyKey: 'restart-retry-key', expectedEpoch: 'old-epoch' },
  });

  // Malformed retry record or simultaneous pending+retry is rejected on restore.
  recoveryStorage.setItem(
    'aurvin:submission:v1:/api',
    JSON.stringify({
      pending: null,
      retry: { sessionId: 'session-one', turnId: 'turn-one', request: { idempotencyKey: 'bad', model: 'forged' } },
      epoch: 'old-epoch',
    }),
  );
  expect(new ApiClient({ fetch: fetcher, recoveryStorage }).retryRecovery).toBeNull();
});
