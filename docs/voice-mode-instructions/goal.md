# Cache-friendly text and live-voice instructions

## Goal

Make Aurvin compose answers for the current output mode while retaining one stable system prompt and a reusable request prefix. The user approved this design, authorized implementation, and confirmed this written specification with “Approve and implement” on 16 October 2026.

## Agreed design

Every model request contains, in order:

1. The same fixed system instructions, defining both text and live-voice behavior.
2. The same fixed product background.
3. The selected current-session history, using the existing voice-delivery reconciliation rules.
4. One short backend-owned system message selecting `text` or `voice` for this response.
5. The latest user input, once, with the `user` role.

The selector changes, not the large shared instructions. It is derived from the backend's actual response channel, not from user wording, a client-supplied system prompt, or a previous turn's mode. Composer submissions remain text mode even when their content originated from speech transcription. Live voice selects voice mode.

## Output behavior

### Text

Preserve normal text-chat behavior, including Markdown tables, code, formulas, and the existing Canvas Mermaid/chart formats when useful. Scope Canvas-specific instructions to text mode so they do not contradict voice instructions.

### Live voice

- Compose natural, clear spoken sentences suitable for Text-to-Speech. Be concise without omitting information needed to answer accurately.
- Do not emit visual markup, tables, Mermaid/chart blocks, code listings, JSON, HTML, or LaTeX.
- Describe comparisons, relationships, processes, and simple mathematics in words. Preserve important names, numbers, units, qualifications, and negations; do not invent missing visual data.
- Do not refer to an answer, table, Canvas, or diagram as if the listener can see it.
- If an exact visual, formula, or code listing is essential, give a useful spoken explanation and offer to continue in text chat. Do not claim to switch the interface or perform an unavailable action.
- Keep the existing `SpeechProse` filter as a safety net, unchanged by this work. Prompting is not a guarantee of model compliance.

## Request and persistence boundaries

- Select the mode for every fresh inference request, including explicit retries. A later text response must not inherit voice style merely because a previous response was live voice.
- Keep the selector immediately before the latest user message, after reusable history. Do not add mode-dependent content to the fixed prefix.
- Do not save selector messages as user/assistant transcript records, memory references, or graph conversation history. Existing version/boundary metadata may continue to identify the shared instructions as usual.
- Include selector overhead in the existing context/message budgets, startup fit checks, and pre-inference checks. Overflow remains explicit; do not silently discard history.
- Preserve provider identity attribution, existing model settings, checkpoint/recovery semantics, and voice-delivery evidence. Recovery that reuses a saved result must not start fresh inference just to apply the new style.

## Cache contract

For identical assets and selected history, requests in text and voice modes must have identical messages up to the selector. Verify the actual outbound provider payload as well as assembled context, accounting for any installed SDK normalization.

The initial shared-instruction edit changes the old prefix once. Thereafter mode switching must not rewrite that prefix. This is cache-friendly request construction, not a guarantee of cache hits, a particular discount, or an exact hit rate. Provider/model support, routing, minimum token thresholds, expiry, and any explicit cache configuration remain separate concerns.

## Acceptance criteria

1. The shared prompt defines both modes and preserves text Canvas guidance without applying it to voice.
2. Text and live requests each contain exactly one backend-owned current-mode system selector immediately before exactly one latest user message.
3. With the same assets/history/input, changing only the output mode leaves all preceding request messages identical, including in the captured outbound provider payload.
4. Mode selection is recomputed for subsequent turns and explicit retries; voice-to-text switching cannot leave a stale voice selector.
5. Selectors are absent from durable user/assistant records and checkpoint conversation state; existing history selection and delivered-speech rules still hold.
6. Context budgets include the added message and its bytes/framing; boundary tests reject overflow before inference.
7. Deterministic tests cover selector order/authority, defaults, mode switching, retries, fixed-prefix equality, provider serialization, persistence isolation, and the unchanged speech filter. Backend build, lint, routine tests, and e2e checks are run with actual skips and blockers recorded separately.

## Scope and alternatives

The approved approach is a permanent dual-mode prompt plus a short per-request selector. Swapping large system prompts would disrupt shared-prefix reuse. Filtering alone cannot reliably turn visual content into spoken explanations.

No new model, dependency, UI control, provider cache policy, rewrite model, visual renderer, automatic screen switch, infrastructure provisioning, live paid call, or deployment is included. Actual model obedience and provider cache discounts need separately authorized live measurement; deterministic tests do not establish them.

## Workspace and workflow

- Branch: `codex/voice-mode-instructions`, based on `main` through the user-approved worktree move.
- Preserve the pre-existing change in `backend/test/voice/agent/voice-delivery.spec.ts`; do not stage, modify, or commit it.
- Use one focused implementation plan after targeted research. No frontend changes are expected.
- Unified review is **skipped** under the repository's existing instruction. Meaningful tests, compatibility checks, defect correction, and final verification remain required.
