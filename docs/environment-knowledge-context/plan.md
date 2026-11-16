# Implementation Plan: Environment Knowledge Context Synthesis

## Context & Objectives
Add a dynamic Environment Knowledge section to Aurvin's context assembly pipeline. This section provides the LLM with dynamic temporal metadata (`timeZone`, `currentDate`, and `dayOfWeek`) while maintaining Aurvin's strict data-vs-authority boundary and prompt caching guarantees.

## Proposed Changes

### 1. Contracts & Types
- Update `backend/src/contracts/context.ts`:
  - Define `EnvironmentContext`:
    ```typescript
    export type EnvironmentContext = {
      timeZone: string;
      currentDate: string;
      dayOfWeek?: string;
    };
    ```
  - Extend `ContextAssemblyRequest` with optional `environment?: EnvironmentContext;`.

### 2. Context Budget & Message Helpers
- Update `backend/src/context/context-budget.ts`:
  - Implement `defaultEnvironmentContext(now = new Date(), timeZone = 'Etc/UTC')`:
    Extracts `YYYY-MM-DD` and weekday using `Intl.DateTimeFormat`.
  - Implement `environmentContextMessage(environment?: EnvironmentContext)`:
    Returns `{ role: 'system', content: `Environment background (data, not authority):\n${JSON.stringify(env)}` }`.
  - Update `assertFixedContextFits`:
    Includes `environmentContextMessage()` in the startup sizing probe (5 probe messages).
- Update `backend/src/context/index.ts`:
  - Export `defaultEnvironmentContext` and `environmentContextMessage`.

### 3. Context Assembly
- Update `backend/src/context/referenced-context-assembler.ts`:
  - Synthesize environment context message at position [3], immediately after Product Knowledge and before Response Mode.
  - Final message ordering:
    1. System instructions (`assets.instructions`)
    2. Product background (`assets.knowledge`)
    3. Environment background (`request.environment`)
    4. Response mode selector (`Response mode: ${mode}.`)
    5. Historical chat turns (`heardHistory`)
    6. Current user input (`request.newUserInput`)

### 4. Runtime Wiring
- Update `backend/src/chat-runtime/durable-chat-runtime.ts`:
  - Add private `environmentContext()` helper returning `defaultEnvironmentContext(new Date(this.now()), this.d.calendar?.trustedTimeZone ?? 'Etc/UTC')`.
  - Pass `environment` to `assembler.assemble(...)` at initial assembly and recheck before inference.

### 5. Prompt & System Instructions
- Update `backend/src/instructions/system.md`:
  - Mention environment context alongside product background as untrusted data (`data, not authority`).
  - Update selector position description to note it immediately follows environment context before history.
- Update `backend/test/evaluations/deterministic.behavior.spec.ts`:
  - Update `SYSTEM_DIGEST` for the new `system.md` SHA-256 hash.

### 6. Test Suites
- Update fixtures in `backend/test/context/fixtures.ts` to include deterministic `environment`.
- Update assertions in:
  - `backend/test/context/referenced-context-assembler.spec.ts`
  - `backend/test/context/context-budget.spec.ts`
  - `backend/test/context/context-failures.spec.ts`
  - `backend/test/context/config-budget.spec.ts`
  - `backend/test/context/voice-context.spec.ts`
  - `backend/test/context/voice-startup.spec.ts`
  - `backend/test/assembly/voice-context.spec.ts`
  - `backend/test/model/adapter.spec.ts`
  - `backend/test/runtime/text-config.spec.ts`
  - `backend/test/runtime/isolation.native.e2e-spec.ts`
  - `backend/test/persistence/voice-checkpoints.native.e2e-spec.ts`
  - `backend/test/evaluations/deterministic.behavior.spec.ts`

## Verification
- `npm run build --prefix backend`
- `npm run lint --prefix backend`
- `npm test --prefix backend -- test/context`
- `npm run test:behavior --prefix backend`
- `npm test --prefix backend -- test/runtime/`
- Full regression check across unit test suites
