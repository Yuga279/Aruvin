# Live voice: spoken-output behavior

Recorded: 16 October 2026.
Status: **current behavior note**. Not implemented, not scheduled, not part of [voice-cost-and-flow](voice-cost-and-flow/goal.md).

This note exists so the spoken-style gap can be reviewed later and turned into a separate product decision.

## Question

When Aurvin is in live voice, does the model know the user is listening and write in a form that Text-to-Speech can read aloud? In particular: markdown tables, mermaid diagrams, and mathematical formulas.

**Answer: no.** Live voice currently *filters* the text-chat answer after generation. It does **not** instruct the model to compose spoken prose.

## What happens today

```
user speech
  → Flux STT (completed turn)
  → same text-chat model and system instructions
  → SpeechProse filter (live only)
  → Flux TTS
```

1. Live voice uses the **same OpenRouter model** as text chat. There is no UI model picker and no voice-specific model.
2. The system prompt in [`backend/src/instructions/system.md`](../backend/src/instructions/system.md) still says Aurvin is a **helpful text-chat assistant**. It does not mention voice, listening, TTS, or “do not use tables / diagrams / LaTeX.”
3. After tokens stream, live mode runs [`SpeechProse`](../backend/src/voice/agent/speech-prose.ts) in [`durable-chat-runtime.ts`](../backend/src/chat-runtime/durable-chat-runtime.ts) (`prose = c.live ? new SpeechProse(...) : null`). Text chat does not use this filter.
4. The live surface does not show the assistant transcript. Whatever `SpeechProse` emits is what TTS may speak. Dropped structure is not described to the listener.

So the model can still *plan* a table, mermaid chart, or formula. The listener often hears a gap, a stripped sentence, or nothing for that part—not a spoken equivalent.

## What `SpeechProse` does

It is a conservative streaming sanitizer, not a spoken-language rewriter.

| Input | Typical result |
| --- | --- |
| Headings, list markers, links, bold/italic | Markers stripped; remaining words kept |
| Simple inline code such as `` `ABC-42` `` | Backticks stripped; identifier kept |
| Fenced code (` ``` ` / `~~~`), including mermaid fences | Entire fence skipped |
| Raw JSON / `{ ... }` objects | Entire object skipped |
| Markdown tables (`\|`) or leftover `{ } < >` | Unit dropped |
| Leftover `` ` [ ] * ``, HTML entities, `---` rules | Unit dropped |
| Names, numbers, dates, amounts, negations in plain prose | Kept |

It does **not**:

- Tell the model it is in voice mode.
- Rewrite a table as “row one is …, row two is …”.
- Describe a mermaid diagram.
- Read math aloud (“x squared over two”, “the integral of …”).
- Offer to switch back to text chat when the answer needs a visual.
- Change punctuation into more natural spoken cadence beyond stripping markup.

If a whole answer is a table, diagram, or formula, the user may hear silence or only a leftover sentence. That is a dropped visual, not a spoken explanation.

## What the cost-and-flow work will not change

[docs/voice-cost-and-flow/goal.md](voice-cost-and-flow/goal.md) keeps this filter and may release smaller clauses sooner so speech is less choppy. It does **not** add:

- a live-voice system prompt
- visual-to-speech rewriting
- math-to-speech rewriting
- a “this needs the text screen” offer

Treat spoken composition as a **separate follow-up**, not as an expected outcome of silence gating or sentence-gap work.

## Possible later actions

None of these are approved or in progress. Pick one if this becomes a product goal:

1. **Voice-mode instructions.** When a turn is live, add a bounded instruction: short spoken sentences, no tables/mermaid/LaTeX, describe visuals in words, offer to continue in text if a diagram is required. Keep the existing filter as a safety net.
2. **Spoken rewrite of unsafe units.** If a filtered unit was a table, diagram, or formula, replace it with a short spoken summary instead of dropping it. Needs a spec for what “short” means and how much TTS cost is acceptable.
3. **Visual-task handoff.** If the answer needs a table or diagram, say so and offer return to chat rather than speaking markup or omitting the content silently.
4. **Keep current filter only.** Accept that live voice is prose-only; complex structure is dropped. Document that limit to users.

Any of 1–3 needs its own goal, tests (arbitrary token splits, no leaked reasoning/code, no invented table contents), and a check that text chat is unchanged.

## Pointers

- Filter: [`backend/src/voice/agent/speech-prose.ts`](../backend/src/voice/agent/speech-prose.ts)
- Tests: [`backend/test/voice/agent/speech-prose.spec.ts`](../backend/test/voice/agent/speech-prose.spec.ts)
- Live wiring: [`backend/src/chat-runtime/durable-chat-runtime.ts`](../backend/src/chat-runtime/durable-chat-runtime.ts) (SpeechProse around model deltas)
- Shared instructions: [`backend/src/instructions/system.md`](../backend/src/instructions/system.md)
- Original product intent (not implemented as model prompting): [`voice-modes-prd.md`](../voice-modes-prd.md) — visual tasks should offer return to chat; the live surface does not show response text
