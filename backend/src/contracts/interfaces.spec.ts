/**
 * ============================================================================
 * FILE: interfaces.spec.ts
 * LOCATION: backend/src/contracts/interfaces.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compile-check the shared identity, persistence, context, and runtime APIs.
 *
 * ROLE IN PROJECT:
 *    Demonstrates how downstream plans can implement the contracts with fakes
 *    without introducing infrastructure or cross-collection transactions.
 *
 * KEY COMPONENTS:
 *    - Identity/model tests: Require server identity and provider user attribution.
 *    - Interface fakes: Ensure repository and runtime ports remain implementable.
 * ============================================================================
 */

import { DEFAULT_BUDGETS } from './budgets.js';
import type { ContextAssembler } from './context.js';
import type { IdentityResolver, ResolvedIdentity } from './identity.js';
import type {
  AgentMemoryRepository,
  CheckpointStoreFactory,
  ExecutionOwnership,
  MessageRepository,
  MetadataRepository,
  SessionRepository,
} from './repositories.js';
import type {
  AgentRuntime,
  ModelAdapter,
  ModelInvokeRequest,
} from './runtime.js';

describe('downstream interfaces', () => {
  it('keeps identity server-resolved and OpenRouter user required on model requests', async () => {
    const identity: ResolvedIdentity = {
      userId: 'aurvin-dev-user',
      source: 'server-configured',
      openRouterUser: 'aurvin-dev-user',
    };
    const resolver: IdentityResolver = {
      resolve: () => identity,
    };
    expect(resolver.resolve().source).toBe('server-configured');

    const adapter: ModelAdapter = {
      async *stream(request: ModelInvokeRequest) {
        if (!request.user) {
          throw new Error('missing user');
        }
        yield { type: 'end' as const };
      },
    };
    const chunks = [];
    for await (const chunk of adapter.stream({
      modelId: 'openrouter/test',
      user: identity.openRouterUser,
      messages: [{ role: 'user', content: 'Hi' }],
      maxOutputTokens: DEFAULT_BUDGETS.maxOutputTokens,
      abortSignal: new AbortController().signal,
      transforms: [],
      dataCollection: 'deny',
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: 'end' }]);
  });

  it('is implementable by fakes without cross-collection transactions', async () => {
    const sessions: SessionRepository = {
      get: async () => null,
      list: async () => ({ items: [], nextCursor: null }),
      createIfAbsent: async (record) => record,
      touchActivity: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    };
    const messages: MessageRepository = {
      append: async () => undefined,
      list: async () => ({ items: [], nextCursor: null, olderAvailable: false }),
      get: async () => null,
      updateCompletion: async () => undefined,
    };
    const memory: AgentMemoryRepository = {
      get: async () => null,
      put: async () => undefined,
    };
    const metadata: MetadataRepository = {
      putAttempt: async () => undefined,
      getAttempt: async () => null,
      getAttemptByIdempotency: async () => null,
      putAccounting: async () => undefined,
    };
    const ownership: ExecutionOwnership = {
      acquire: async () => ({
        ok: false,
        code: 'CONFLICT_ACTIVE_TURN',
      }),
      fence: async () => false,
      release: async () => undefined,
    };
    const checkpoints: CheckpointStoreFactory = {
      create: async () => ({ setup: async () => undefined }),
    };
    const context: ContextAssembler = {
      assemble: async () => ({
        ok: false,
        overflow: {
          code: 'CONTEXT_BUDGET_EXCEEDED',
          message: 'This chat is too long. Start a new chat.',
          maxContextTokens: DEFAULT_BUDGETS.maxContextTokens,
          requiredTokens: DEFAULT_BUDGETS.maxContextTokens + 1,
        },
      }),
    };
    const runtime: AgentRuntime = {
      submitTurn: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        userMessageId: 'msg_1',
        streamPath: '/sessions/sess_1/turns/turn_1/stream',
      }),
      cancelTurn: async () => undefined,
      retryTurn: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_2',
        userMessageId: 'msg_1',
        streamPath: '/sessions/sess_1/turns/turn_1/stream',
      }),
      getTurnStatus: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        status: 'interrupted',
        truncated: false,
        error: {
          code: 'INTERRUPTED',
          message: 'Generation was interrupted. Retry to continue.',
          retryable: false,
        },
      }),
      reconcileSession: async () => undefined,
    };

    expect(await sessions.get('aurvin-dev-user', 'sess_1')).toBeNull();
    expect(
      (
        await ownership.acquire({
          userId: 'aurvin-dev-user',
          sessionId: 'sess_1',
          ownerId: 'worker-1',
          leaseMs: 30_000,
        })
      ).ok,
    ).toBe(false);
    expect(
      await context.assemble({
        userId: 'aurvin-dev-user',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        newUserInput: 'Hi',
        responseMode: 'text',
      }),
    ).toMatchObject({ ok: false });
    expect(
      await runtime.getTurnStatus('aurvin-dev-user', 'sess_1', 'turn_1'),
    ).toMatchObject({ status: 'interrupted' });
    expect(messages).toBeDefined();
    expect(memory).toBeDefined();
    expect(metadata).toBeDefined();
    expect(checkpoints).toBeDefined();
  });
});
