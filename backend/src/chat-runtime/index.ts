/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/chat-runtime/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the P5 chat-runtime factory and request-owned execution types.
 *
 * ROLE IN PROJECT:
 *    Lets P6/P8/P9 construct one DurableChatRuntime per persistence bundle
 *    without adding Nest application wiring in this worker.
 *
 * KEY COMPONENTS:
 *    - createChatRuntime: Factory returning the ChatRuntime port.
 *    - Type re-exports: RuntimeDependencies, ExecuteTurn, DrainResult.
 * ============================================================================
 */

import { DurableChatRuntime } from './durable-chat-runtime.js';
import type { RuntimeDependencies, ChatRuntime } from './ports.js';
export { DurableChatRuntime } from './durable-chat-runtime.js';
export type { RuntimeDependencies, ExecuteTurn, ChatRuntime, DrainResult, StreamQuiesceResult, StreamReservation } from './ports.js';
export type {
  CalendarRuntimeDependencies,
  CalendarAccountingPort,
  CalendarOperationsPort,
  CalendarCursor,
  CalendarSeal,
} from './calendar-ports.js';
export function createChatRuntime(dependencies: RuntimeDependencies): ChatRuntime {
  return new DurableChatRuntime(dependencies);
}
