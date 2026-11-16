/**
 * ============================================================================
 * FILE: text-config-fixture.ts
 * LOCATION: backend/test/runtime/text-config-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide an in-memory double of persistence, currentConfig port, and runtime.
 *
 * ROLE IN PROJECT:
 *    Enables deterministic testing of text config snapshot binding, execution,
 *    retry, and admission without MongoDB or live OpenRouter API calls.
 *
 * KEY COMPONENTS:
 *    - TextConfigFixture: Interface for controlling and querying test executions.
 *    - textConfigFixture: Factory assembling real MemorySaver, assembler, and runtime.
 * ============================================================================
 */

import { vi } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { RuntimeDependencies } from '../../src/chat-runtime/ports.js';
import type { CurrentConfigPort, RuntimeConfigSnapshot } from '../../src/contracts/config-runtime.js';
import type { ResolvedIdentity } from '../../src/contracts/identity.js';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import type { SessionRecord } from '../../src/contracts/session.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import type { AttemptRecord } from '../../src/contracts/attempt.js';
import type { AgentMemoryManifest } from '../../src/contracts/agent-memory.js';
import type { AccountingRecord } from '../../src/contracts/metadata.js';
import type { ExecutionLease } from '../../src/contracts/repositories.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { assets } from '../context/fixtures.js';
import { limits } from '../model/helpers.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';

export type TextConfigFixture = {
  runtime: DurableChatRuntime;
  currentConfig: CurrentConfigPort;
  publish(snapshot: RuntimeConfigSnapshot | null): void;
  identity: ResolvedIdentity;
  p: PersistenceBundle;
  saver: MemorySaver;
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  submit(content?: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  execute(ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void>;
  restart(): Promise<void>;
  dispose(): Promise<void>;
};

export function textConfigFixture(
  initialSnapshot: RuntimeConfigSnapshot,
  decorate: (dependencies: RuntimeDependencies) => RuntimeDependencies = value => value,
  persistenceOverride?: PersistenceBundle,
): TextConfigFixture {
  const userId = 'aurvin-dev-user';
  const identity: ResolvedIdentity = {
    userId,
    openRouterUser: userId,
    source: 'authenticated-session',
  };
  const bootstrap = loadBootstrapConfig({ AURVIN_USER_ID: userId });
  const storageBudgets = { ...DEFAULT_BUDGETS, ...bootstrap.safety, ...initialSnapshot.budgets };
  const baseConfig = loadConfig({ AURVIN_USER_ID: userId });

  let currentPointer: RuntimeConfigSnapshot | null = initialSnapshot;
  const currentConfig: CurrentConfigPort = {
    current: () => currentPointer,
  };

  const sessionsMap = new Map<string, SessionRecord>();
  const messagesMap = new Map<string, MessageRecord>();
  const memoryMap = new Map<string, AgentMemoryManifest>();
  const attemptsMap = new Map<string, AttemptRecord>();
  const acceptanceMap = new Map<string, { turnId: string; userMessageId: string; payloadHash: string }>();
  const accountingMap = new Map<string, AccountingRecord>();
  const deliveryMap = new Map<string, VoiceDeliveryRecord>();
  const sequencesMap = new Map<string, number>();

  const sKey = (u: string, s: string) => JSON.stringify([u, s]);
  const iKey = (u: string, s: string, id: string) => JSON.stringify([u, s, id]);

  const clone = <T>(v: T): T => structuredClone(v);

  const owner = {
    executorId: 'current',
    async assertExecutor() {},
    async drain() {},
    async run<T>(_lease: ExecutionLease, action: () => Promise<T>): Promise<T> {
      return action();
    },
    async fence(lease: ExecutionLease): Promise<boolean> {
      const s = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      return Boolean(s && s.execution.ownerId === lease.ownerId && s.execution.generation === lease.generation);
    },
    async acquire({ userId: u, sessionId: s, ownerId, leaseMs }: { userId: string; sessionId: string; ownerId: string; leaseMs: number }) {
      const session = sessionsMap.get(sKey(u, s));
      if (!session) return { ok: false };
      if (session.execution.ownerId !== null) return { ok: false };
      session.execution.ownerId = ownerId;
      session.execution.generation += 1;
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      session.execution.leaseExpiresAt = leaseExpiresAt;
      return { ok: true, lease: { userId: u, sessionId: s, ownerId, generation: session.execution.generation, leaseExpiresAt } };
    },
    async recoverStoppedSession(u: string, s: string, expectedOwnerId: string | null, leaseMs: number): Promise<ExecutionLease> {
      const session = sessionsMap.get(sKey(u, s));
      if (!session) throw new AppError('NOT_FOUND', 'Chat not found.');
      if (expectedOwnerId !== null && session.execution.ownerId !== expectedOwnerId) {
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Another request owns this turn.');
      }
      session.execution.ownerId = 'current';
      session.execution.generation += 1;
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      session.execution.leaseExpiresAt = leaseExpiresAt;
      return { userId: u, sessionId: s, ownerId: 'current', generation: session.execution.generation, leaseExpiresAt };
    },
    async renew(lease: ExecutionLease, leaseMs: number): Promise<ExecutionLease> {
      const session = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      if (!session || session.execution.ownerId !== lease.ownerId || session.execution.generation !== lease.generation) {
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Lease lost.');
      }
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      session.execution.leaseExpiresAt = leaseExpiresAt;
      return { ...lease, leaseExpiresAt };
    },
    async release(lease: ExecutionLease): Promise<void> {
      const session = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      if (session && session.execution.ownerId === lease.ownerId) {
        session.execution.ownerId = null;
        session.execution.leaseExpiresAt = null;
      }
    },
    async reserveAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
      const session = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      if (!session) throw new AppError('NOT_FOUND', 'Chat not found.');
      if (session.execution.activeAttemptId !== null && session.execution.activeAttemptId !== attemptId) {
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Another attempt is active.');
      }
      session.execution.activeAttemptId = attemptId;
    },
    async allocateSequences(lease: ExecutionLease, _attemptId: string, count: number): Promise<{ start: number }> {
      const k = sKey(lease.userId, lease.sessionId);
      const current = sequencesMap.get(k) ?? 0;
      sequencesMap.set(k, current + count);
      return { start: current };
    },
    async confirmAcceptance(lease: ExecutionLease, attemptId: string): Promise<void> {
      const session = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      if (!session) throw new AppError('NOT_FOUND', 'Chat not found.');
      const att = attemptsMap.get(iKey(lease.userId, lease.sessionId, attemptId));
      if (!att) throw new AppError('NOT_READY', 'Attempt not found.');
      acceptanceMap.set(iKey(lease.userId, lease.sessionId, attemptId), {
        turnId: att.turnId,
        userMessageId: att.causal.userMessageId,
        payloadHash: att.payloadHash,
      });
      session.latestTurnId = att.turnId;
    },
    async clearAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
      const session = sessionsMap.get(sKey(lease.userId, lease.sessionId));
      if (session && session.execution.activeAttemptId === attemptId) {
        session.execution.activeAttemptId = null;
      }
    },
  };

  const saver = new MemorySaver();

  const p: PersistenceBundle = persistenceOverride ?? ({
    owner,
    checkpoints: {
      create: async () => ({ bind: () => saver }),
    },
    sessions: {
      async get(u: string, s: string) {
        const item = sessionsMap.get(sKey(u, s));
        return item ? clone(item) : null;
      },
      async createIfAbsent(record: SessionRecord) {
        const k = sKey(record.userId, record.sessionId);
        if (!sessionsMap.has(k)) {
          sessionsMap.set(k, clone(record));
        }
      },
      async createForInternalTurn(record: SessionRecord) {
        const k = sKey(record.userId, record.sessionId);
        sessionsMap.set(k, clone(record));
      },
      async touchActivity(u: string, s: string, at: string) {
        const session = sessionsMap.get(sKey(u, s));
        if (session) session.lastActivityAt = at;
      },
    },
    messages: {
      budgets: storageBudgets,
      async get(u: string, s: string, id: string) {
        const item = messagesMap.get(iKey(u, s, id));
        return item ? clone(item) : null;
      },
      async append(record: MessageRecord) {
        const k = iKey(record.userId, record.sessionId, record.messageId);
        if (messagesMap.has(k)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Duplicate message ID.');
        messagesMap.set(k, clone(record));
      },
      async getReferences(u: string, s: string, refs: readonly { messageId: string }[]) {
        const result: MessageRecord[] = [];
        for (const ref of refs) {
          const item = messagesMap.get(iKey(u, s, ref.messageId));
          if (item) result.push(clone(item));
        }
        return result;
      },
      async list(u: string, s: string) {
        const prefix = JSON.stringify([u, s]).slice(0, -1);
        const items: MessageRecord[] = [];
        for (const [k, v] of messagesMap.entries()) {
          if (k.startsWith(prefix)) items.push(clone(v));
        }
        items.sort((a, b) => a.sequence - b.sequence);
        return { items, nextCursor: null };
      },
      async listForContext(u: string, s: string) {
        return this.list(u, s);
      },
      async updateCompletion(u: string, s: string, id: string, completionStatus: MessageRecord['completionStatus'], truncated: boolean) {
        const item = messagesMap.get(iKey(u, s, id));
        if (item) {
          item.completionStatus = completionStatus;
          item.truncated = truncated;
        }
      },
    },
    memory: {
      budgets: storageBudgets,
      async get(u: string, s: string) {
        const item = memoryMap.get(sKey(u, s));
        return item ? clone(item) : null;
      },
      async put(manifest: AgentMemoryManifest) {
        memoryMap.set(sKey(manifest.userId, manifest.sessionId), clone(manifest));
      },
    },
    metadata: {
      budgets: storageBudgets,
      async getAttempt(u: string, s: string, id: string) {
        const item = attemptsMap.get(iKey(u, s, id));
        return item ? clone(item) : null;
      },
      async getAttemptByIdempotency(u: string, s: string, idempotencyKey: string) {
        for (const [k, v] of attemptsMap.entries()) {
          const [cu, cs] = JSON.parse(k);
          if (cu === u && cs === s && v.idempotencyKey === idempotencyKey) {
            return clone(v);
          }
        }
        return null;
      },
      async listAttempts(u: string, s: string) {
        const prefix = JSON.stringify([u, s]).slice(0, -1);
        const items: AttemptRecord[] = [];
        for (const [k, v] of attemptsMap.entries()) {
          if (k.startsWith(prefix)) items.push(clone(v));
        }
        items.sort((a, b) => a.sequence - b.sequence);
        return { items, nextCursor: null };
      },
      async latestAttempt(u: string, s: string, t: string) {
        return [...attemptsMap.values()].filter(a => a.userId === u && a.sessionId === s && a.turnId === t)
          .sort((a, b) => b.sequence - a.sequence).map(clone)[0] ?? null;
      },
      async getAcceptances(u: string, s: string, ids: readonly string[]) {
        return ids.flatMap(attemptId => {
          const value = acceptanceMap.get(iKey(u, s, attemptId));
          return value ? [{ ...clone(value), attemptId }] : [];
        });
      },
      async putAttempt(attempt: AttemptRecord) {
        attemptsMap.set(iKey(attempt.userId, attempt.sessionId, attempt.attemptId), clone(attempt));
      },
      async compareAttempt(attempt: AttemptRecord, expectedStatus: AttemptRecord['status']) {
        const existing = attemptsMap.get(iKey(attempt.userId, attempt.sessionId, attempt.attemptId));
        if (!existing || existing.status !== expectedStatus) return false;
        attemptsMap.set(iKey(attempt.userId, attempt.sessionId, attempt.attemptId), clone(attempt));
        return true;
      },
      async getAcceptance(u: string, s: string, id: string) {
        const item = acceptanceMap.get(iKey(u, s, id));
        return item ? clone(item) : null;
      },
      async getAccounting(u: string, s: string, id: string) {
        const item = accountingMap.get(iKey(u, s, id));
        return item ? clone(item) : null;
      },
      async putAccounting(record: AccountingRecord) {
        accountingMap.set(iKey(record.userId, record.sessionId, record.attemptId), clone(record));
      },
      async getVoiceDelivery(u: string, s: string, id: string) {
        const record = deliveryMap.get(iKey(u, s, id));
        return record ? clone(record) : null;
      },
      async compareVoiceDelivery(record: VoiceDeliveryRecord, expectedSequence: number) {
        const k = iKey(record.userId, record.sessionId, record.attemptId);
        if (deliveryMap.get(k)?.sequence !== expectedSequence) return false;
        deliveryMap.set(k, clone(record));
        return true;
      },
      async putVoiceDelivery(record: VoiceDeliveryRecord) {
        deliveryMap.set(iKey(record.userId, record.sessionId, record.attemptId), clone(record));
      },
    },
  } as unknown as PersistenceBundle);

  let genIdCounter = 1;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const urlStr = String(url);
    if (!urlStr.includes('/chat/completions')) {
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    }
    const genId = `gen_fixture_${genIdCounter++}`;
    const body = FRAMES.normal.replaceAll('gen_fixture', genId);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  });

  const assembler = new ReferencedContextAssembler({
    memory: p.memory,
    messages: p.messages,
    metadata: p.metadata,
    budgets: initialSnapshot.budgets,
    assets,
  });

  const deps = decorate({
    config: {
      ...baseConfig,
      budgets: storageBudgets,
    },
    persistence: p,
    assembler,
    assets,
    limits: initialSnapshot.modelLimits ?? limits,
    currentConfig,
    fetcher,
  });

  let runtime = new DurableChatRuntime(deps);

  let requestCounter = 1;

  return {
    get runtime() { return runtime; },
    currentConfig,
    publish(snapshot: RuntimeConfigSnapshot | null) {
      currentPointer = snapshot;
    },
    identity,
    p,
    saver,
    fetcher,
    async submit(content?: string, sessionId?: string | null) {
      const id = String(requestCounter++).padStart(4, '0');
      return runtime.submitTurn({
        identity,
        sessionId: sessionId ?? null,
        content: content ?? 'Hello',
        idempotencyKey: `request-${id}`,
      });
    },
    async execute(ids: SubmitTurnResponse, signal?: AbortSignal) {
      await runtime.executeTurn({
        userId: identity.userId,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
        attemptId: ids.attemptId,
        signal: signal ?? new AbortController().signal,
        emit: async () => {},
      });
    },
    async restart() {
      runtime.stopAccepting();
      await runtime.drain(5000);
      runtime = new DurableChatRuntime(deps);
    },
    async dispose() {
      runtime.stopAccepting();
      await runtime.drain(5000);
    },
  };
}
