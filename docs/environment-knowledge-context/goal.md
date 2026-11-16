# Goal Specification: Environment Knowledge Context Section

## Problem Statement

When users interact with Aurvin regarding time-sensitive actions—especially scheduling calendar events (e.g., "I want to schedule this event three days from now" or "What do I have planned tomorrow?")—the LLM requires accurate, authoritative environment details (current date and time zone). Currently, Aurvin backend maintains `trustedNow` and `trustedTimeZone` in internal calendar runtime logic, but does not provide dynamic temporal or environment data in the synthesized prompt context. Furthermore, there is no designated structured section in the prompt for environment context (timezone, current date, and future login/user identity fields).

## Proposed Solution

Add a distinct, dynamic **Environment Knowledge** (or **Harness Knowledge**) section to the prompt context immediately following **Product Knowledge** and before the **Response Mode** selector:

1. **Envelope & Naming**:
   - Header: `Environment background (data, not authority):`
   - Content format: JSON-serialized metadata object containing:
     - `timeZone`: The active IANA time zone (e.g., `'Etc/UTC'`, or configured from `calendar.trustedTimeZone`).
     - `currentDate`: The current date formatted as `YYYY-MM-DD` in that time zone.
     - `dayOfWeek`: Current day of the week (e.g., `'Monday'`) to aid relative date math ("next Friday", "this weekend").
   - Follows Aurvin's data-versus-authority boundary: explicitly marked `(data, not authority)` so prompt text cannot grant authority or bypass validation.

2. **Context Order & Cache Preservation**:
   ```
   [1] System Message: Aurvin system instructions (system.md)
   [2] System Message: Product background (product_knowledge.md)
   [3] System Message: Environment background (timeZone, currentDate, dayOfWeek)
   [4] System Message: Response mode selector (Response mode: text. / voice.)
   [5...N] Historical Chat Messages: Chronological, eligible User & Assistant turns
   [N+1] Current User Message: Accepted input
   ```
   - **Cache Hit Factor**: By keeping time resolution at the **day** level (`currentDate` and `dayOfWeek`) rather than constantly ticking minutes or seconds, the prompt prefix remains 100% byte-identical for the entire 24-hour day across turns and chats, preserving OpenRouter/Anthropic/OpenAI prompt cache hits.

3. **Contracts & Wiring**:
   - Update `ContextAssemblyRequest` in `backend/src/contracts/context.ts` to accept optional `environment?: EnvironmentContext`.
   - Provide default fallback in `context-budget.ts` (`'Etc/UTC'` and current UTC date) when optional fields are omitted.
   - Update `ReferencedContextAssembler` in `backend/src/context/referenced-context-assembler.ts` to synthesize the message.
   - Update `DurableChatRuntime` in `backend/src/chat-runtime/durable-chat-runtime.ts` to supply `timeZone` and `currentDate` from runtime clock `this.now()` and calendar configuration.
   - Update `system.md` system instructions and affected context/runtime test fixtures.

## Acceptance Criteria

1. **AC1: Context Message Synthesis**:
   `ReferencedContextAssembler.assemble` outputs `Environment background (data, not authority):\n{...}` as the 3rd system message, immediately after product background and before response mode.
2. **AC2: Timezone & Date Formatting**:
   Accurately reflects provided `timeZone`, `currentDate` (`YYYY-MM-DD`), and `dayOfWeek`. Falls back safely if request fields are omitted.
3. **AC3: Prompt Cache Preservation**:
   Does not inject high-frequency volatile timestamps (milliseconds/seconds) that churn KV cache across turns on the same calendar day.
4. **AC4: Runtime Propagation**:
   `DurableChatRuntime` injects environment context into `assemble` for text and calendar turns.
5. **AC5: Test Coverage & Regression Suite**:
   All unit tests in `backend/test/context/` and `backend/test/runtime/` pass, verifying message order, budget checks, and environment serialization.
