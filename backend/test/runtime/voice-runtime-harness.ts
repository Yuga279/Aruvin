/**
 * ============================================================================
 * FILE: voice-runtime-harness.ts
 * LOCATION: backend/test/runtime/voice-runtime-harness.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Isolated native test harness with referenced context assembler for voice.
 *
 * ROLE IN PROJECT:
 *    Sets up isolated MongoDB persistence, ReferencedContextAssembler, and
 *    DurableChatRuntime for native acceptance, recovery, and bridge testing.
 *
 * KEY COMPONENTS:
 *    - voiceRuntimeHarness: Helper to create isolated native runtime fixture.
 * ============================================================================
 */

import { nativeHarness } from './native-harness.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';

export async function voiceRuntimeHarness(text?: string) {
  const h = await nativeHarness(text);
  h.deps.assembler = new ReferencedContextAssembler({
    memory: h.persistence.memory,
    messages: h.persistence.messages,
    metadata: h.persistence.metadata,
    assets: h.deps.assets,
    budgets: h.deps.config.budgets,
  });
  const runtime = new DurableChatRuntime(h.deps);
  return { ...h, runtime };
}
