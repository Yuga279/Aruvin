/**
 * ============================================================================
 * FILE: calendar-ports.ts
 * LOCATION: backend/src/chat-runtime/calendar-ports.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define runtime ports, dependency interfaces, cursors, and seals for Calendar chat execution.
 *
 * ROLE IN PROJECT:
 *    Decouples durable chat runtime from concrete Calendar v1 and v2 implementations,
 *    providing explicit v2 runtime contracts and typed continuation state.
 *
 * KEY COMPONENTS:
 *    - CalendarRuntimeV2Dependencies: v2 runtime dependencies with capability gate and execution port v2.
 *    - LegacyCalendarRuntimeDependencies: Read-only/legacy v1 dependencies.
 *    - CalendarRuntimeDependencies: Union of legacy and v2 dependencies.
 *    - isCalendarV2: Type guard distinguishing executable v2 branch.
 *    - CalendarAccountingPort / CalendarOperationsPort: Store aliases.
 *    - CalendarCursor / CalendarSeal: Turn graph state definitions.
 * ============================================================================
 */

import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { CalendarAccountingStore, CalendarAccountingStoreV2 } from '../contracts/calendar-accounting.js';
import type { CalendarAccountBinding, CalendarConnectionRecordV2 } from '../contracts/calendar-discovery.js';
import type { CalendarCapabilityGate } from '../contracts/calendar-authority.js';
import type {
  CalendarConnectionBinding,
  CalendarConnectionGate,
} from '../contracts/calendar-connections.js';
import type { CalendarRepairDiagnostics, SkillModelPort } from '../contracts/calendar-model.js';
import type {
  CalendarExecutionPort,
  CalendarExecutionPortV2,
  CalendarOperationStore,
  CalendarOperationStoreV2,
} from '../contracts/calendar-operations.js';
import type { CalendarLimits } from '../contracts/calendar-policy.js';
import type { createCalendarModelPort, createCalendarModelPortV2 } from '../model/calendar-adapter.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { Boundary, GraphInput } from '../agent/state.js';

export type LegacyCalendarRuntimeDependencies = {
  connection: CalendarConnectionGate & {
    currentBinding(): Promise<CalendarConnectionBinding>;
  };
  execution: CalendarExecutionPort;
  createModelPort: typeof createCalendarModelPort;
  trustedTimeZone: string;
  permission: { content: 'volatile' | 'retained'; minimalEvidenceAllowed: boolean; policyId: string };
  auditDeadlineAt?: string;
};

export type CalendarRuntimeV2Dependencies = {
  connection: {
    currentAccount(): Promise<CalendarAccountBinding>;
    requireAccountCurrent(account: CalendarAccountBinding, signal: AbortSignal): Promise<CalendarConnectionRecordV2>;
  };
  capabilities: CalendarCapabilityGate;
  execution: CalendarExecutionPortV2;
  createModelPort: (...args: Parameters<typeof createCalendarModelPortV2>) => SkillModelPort;
  trustedTimeZone: string;
  permission: { content: 'volatile' | 'retained'; minimalEvidenceAllowed: boolean; policyId: string };
  auditDeadlineAt?: string;
};

export type CalendarRuntimeDependencies = LegacyCalendarRuntimeDependencies | CalendarRuntimeV2Dependencies;

export function isCalendarV2(value: CalendarRuntimeDependencies): value is CalendarRuntimeV2Dependencies {
  return 'capabilities' in value;
}

export type CalendarAccountingPort = CalendarAccountingStoreV2 &
  Pick<PersistenceBundle['calendarAccounting'], 'reconcileReservations' | 'listAttemptAccounting'>;
export type CalendarOperationsPort = CalendarOperationStore &
  Pick<PersistenceBundle['calendarOperations'], 'putReconciliation'>;

export function asCalendarAccountingPort(persistence: PersistenceBundle): CalendarAccountingPort {
  return Object.assign(persistence.calendarAccountingV2, {
    reconcileReservations: (userId: string, sessionId: string, turnId: string) =>
      persistence.calendarAccounting.reconcileReservations(userId, sessionId, turnId),
    listAttemptAccounting: (userId: string, sessionId: string, turnId: string, attemptId: string) =>
      persistence.calendarAccounting.listAttemptAccounting(userId, sessionId, turnId, attemptId),
  });
}

export type CalendarCursor = {
  version: 1;
  configRevision: number;
  connectionId: string;
  connectionRevision: number;
  targetRevision: number;
  trustedNow: string;
  trustedTimeZone: string;
  limits: CalendarLimits;
  next: 'decide' | 'execute' | 'seal';
  pendingDecisionId: string | null;
  repair: { rejectedDecisionId: string; diagnostics: CalendarRepairDiagnostics } | null;
};

export type CalendarSeal = {
  version: 1;
  input: GraphInput;
  base: Boundary;
  target: AgentMemoryManifest;
  finalDecisionId: string;
  dispatchIds: string[];
  operationId: string | null;
  outcome: 'completed' | 'truncated';
  assistantCreatedAt: string;
};
