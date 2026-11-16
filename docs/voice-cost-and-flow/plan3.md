# Continuous Safe Text Delivery and Bounded PCM Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver safe prose earlier, amortize delivery evidence without speaking unpersisted text, and absorb ordinary PCM jitter with one bounded 100 ms startup reserve while retaining exact heard-versus-generated evidence.

**Architecture:** Change the existing `SpeechProse` fallback, keep one bounded generated-text accumulator inside `VoiceDelivery`, and reuse its serialized evidence writer. The first safe batch starts its durable write immediately; subsequent clauses coalesce for at most 100 ms or 512 unpersisted characters, then Speak follows the successful write without another delay. Add one scheduling-origin reserve to the browser playback service; retain contiguous sample scheduling, its existing finite PCM queue, and immediate interruption.

**Tech Stack:** Existing TypeScript ESM/NodeNext backend, Vitest, in-memory runtime/MemorySaver fixtures, and browser Web Audio scheduling tested with the existing `FakeContext`. No new dependency, provider request, schema, setting, or audio processing algorithm.

---

## Steps

- [x] Task 1: Release completed plain clauses at 24 characters without weakening syntax guards.
- [x] Task 2: Coalesce generated evidence with a bounded, durable-before-Speak pump.
- [x] Task 3: Drain terminal evidence, fence failures, and retain one final Flush.
- [x] Task 4: Prove the actual scoped live runtime path with split tokens and slow writes.
- [x] Task 5: Add the one-time PCM startup origin and local underrun observations.
- [x] Task 6: Prove jitter recovery, exact playback accounting, and immediate invalidation.
- [x] Task 7: Execute package regression gates and hand off measured limitations.

## Scope, prerequisites, and safety decisions

Read `AGENTS.md`, [goal.md](goal.md), [research.md](research.md), [state.md](state.md), and this plan before implementation. P1 is implemented and committed; dispatch HEAD was `eac406e`. Stay on `codex/voice-cost-and-flow`; preserve later P2/orchestrator commits and uncommitted work. Do not switch branches or edit canvas files. Shared Git staging/commits are serialized with the orchestrator; stage only named P3 paths. If the index is locked, wait for the owner and retry, never delete the lock.

This is P3 only. Do not edit `live-flow.ts`, any TTS adapter, shared wire/config contracts, capture/detector/controller/reducer/UI, package manifests/lockfiles, `app.service.ts`, `plan2.md`, `plan4.md`, or the orchestrator's state/evidence records. Existing `LiveFlow` observations already cover model-first-output, TTS-first-audio, playback-first-ack, and delivery-settled. P4 owns cross-layer assembly and external evidence. Unified review is **skipped**, never passed; do not dispatch a reviewer. The assigned worker executes this plan itself and does not create children unless the orchestrator explicitly allocates them.

### Resolve the immediate-Speak/durability tension explicitly

Research section 3 proposes Speak before its new generated-evidence write, but the approved goal, state exit gate, and planner dispatch require **generated-before-Speak durability**. Both cannot literally hold for the same newly generated character. This plan retains the stronger safety requirement: immediate dispatch means **immediately after the batch's successful durable write**, not speech of an unpersisted clause. The first batch has no intentional 100 ms hold. Later clauses may wait for the bounded coalescing deadline and actual persistence latency. Do not weaken this ordering to make a timing assertion pass; report that latency honestly to P4. A different interpretation requires an explicit upstream decision, not a worker silently removing durability.

The 100 ms evidence bound is a **write-request/coalescing deadline**, not a promise that a database write finishes within 100 ms. A slow existing write serializes the next one and applies backpressure at 512 characters. At a crash, at most 512 accepted-but-unpersisted characters may be lost; **none of them has been dispatched to TTS**. Durable generated text still is not proof of heard text.

The dispatch instruction fixes a 100 ms delay for the first playback packet of each response, including a first packet containing 100–200 ms of PCM. Do not implement the research paragraph's optional large-first-packet exception: packet duration is not a future-arrival reserve. No reserve is reapplied at sentence boundaries or after an underrun. A future adaptive rebuffer policy is not in P3.

## File map

| File | Responsibility / permitted edit |
| --- | --- |
| `backend/src/voice/agent/speech-prose.ts` | Change only the plain fallback threshold/window; retain conservative syntax recognition and total raw-input bound. |
| `backend/test/voice/agent/speech-prose.spec.ts` | Cadence and exact-content fixtures across arbitrary token cuts. |
| `backend/src/voice/agent/voice-delivery.ts` | One bounded dirty-text accumulator and one serialized durable-write/Speak pump; terminal draining/failure fencing. |
| `backend/test/voice/agent/voice-delivery.spec.ts` | Timing, backpressure, ordering, terminal, cancellation, and progress regressions. |
| `backend/src/chat-runtime/durable-chat-runtime.ts:431–466,512–527,592–600` | Inspect the existing live start/delta/finish/settle await boundaries. No implementation change is expected: the new `delta()` resolves on bounded admission, while `finish()` remains the drain barrier. Never replace these awaits with fire-and-forget calls. |
| `backend/test/runtime/voice-output.spec.ts` (new) | Direct deterministic test of that scoped live runtime output path, using existing in-memory fixture; no native database. |
| `frontend/src/features/voice/audio/audio-playback-service.ts` | Separate startup scheduling state from wire-offset state, add a 100 ms response origin, and expose small payload-free local scheduling observations. |
| `frontend/src/features/voice/audio/audio-playback-service.test.ts` | Existing Web Audio fake, jitter/burst schedules, exact samples, interrupt/overflow/drain behavior. |

Reuse `backend/test/runtime/text-config-fixture.ts`, `backend/test/fixtures/openrouter/frames.ts`, shared voice fixtures, and `frontend/src/features/voice/audio/testing/audio-fakes.ts` **without editing them**. New code files need the mandatory project header before imports. Existing target files already have headers; update their component descriptions if necessary. Backend local imports end in `.js`; frontend follows its current extensionless style. Keep existing Vitest infrastructure. Use `ponytail:` comments for the fixed batching/reserve ceilings, not a new abstraction or dependency.

All npm commands below run in the named package directory. Git commands run at repository root. Never print credentials/URIs, use actual microphones, call Deepgram/OpenRouter, start application services against their configured database, or provision/deploy anything.

## Task 1: Earlier plain-clause release with unchanged safety guards

**Files:** `backend/src/voice/agent/speech-prose.ts`; `backend/test/voice/agent/speech-prose.spec.ts`.

- [x] **Step 1: Append failing cadence and token-cut tests.** Existing imports and `normalize` suffice.

```typescript
it('releases a completed 24-character plain clause before the next sentence', () => {
  const f = new SpeechProse();
  expect(f.push('Keep every word in orde')).toBe('');
  expect(f.push('r ')).toBe('Keep every word in order');
  expect(f.push('and preserve demo_id exactly ₹12.50')).toBe(' and preserve demo_id exactly');
  expect(f.finish()).toBe(' ₹12.50');
});

it('keeps guarded syntax private at every cut with the lower release threshold', () => {
  const secret = 'private reasoning and code must never become speech '.repeat(4);
  const cases: Array<[string, string]> = [
    [`<analysis>${secret}</analysis>Keep every word in order and do not cancel ABC-42.`,
      'Keep every word in order and do not cancel ABC-42.'],
    [`<think data-x="1">${secret}</think>Safe final answer.`, 'Safe final answer.'],
    ['```ts\n' + secret + '\n```\nSafe final answer.', 'Safe final answer.'],
    ['~~~ts\n' + secret + '\n~~~\nSafe final answer.', 'Safe final answer.'],
    [`{"tool":{"text":"${secret}"}}\nSafe final answer.`, 'Safe final answer.'],
    [`| ${secret} | value |\nSafe final answer.`, 'Safe final answer.'],
    ['[an incomplete link with many words and private syntax', ''],
    ['Use `rm -rf private_path`.', ''],
    ['**Do not cancel ABC-42** on 2026-10-08. See [Aurvin](https://example.test).',
      'Do not cancel ABC-42 on 2026-10-08. See Aurvin.'],
  ];
  for (const [raw, expected] of cases) {
    expect(normalize([raw])).toBe(expected);
    expect(normalize([...raw])).toBe(expected);
    for (let cut = 0; cut <= raw.length; cut++)
      expect(normalize([raw.slice(0, cut), raw.slice(cut)])).toBe(expected);
  }
});

it('keeps complete long identifiers and whitespace-delimited facts in exact order', () => {
  const raw = 'Do not cancel ' + 'A'.repeat(90) + ' or demo_id on 2026-10-08 for ₹12.50';
  expect(normalize([raw])).toBe(raw);
  expect(normalize([...raw])).toBe(raw);
  const f = new SpeechProse();
  expect(f.push('Keep every word in order\t')).toBe('Keep every word in order');
  expect(f.finish()).toBe('');
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/agent/speech-prose.spec.ts -t "24-character|every cut|long identifiers"`. Expected: cadence/tab assertions fail because the fallback still requires 96 characters. Guard assertions remain a safety oracle; never change their expected content to accept leakage.

- [x] **Step 3: Replace only the fallback selection block.** Keep all preceding hidden-tag, fence, JSON, inline-code, brackets/parentheses, table/ambiguous-markup checks and `plain()` unchanged:

```typescript
if (end < 0 && !final && this.buffer.length >= 24 &&
  !/[`\[\]{}|<>*&#]/u.test(this.buffer) && !/(?:^|\s)_(?:_|\w)|__(?:\w|$)/u.test(this.buffer)) {
  // ponytail: 24-character release, 64-character whitespace search; indivisible words wait for a safe boundary within the existing total answer bound.
  const boundary = this.buffer.slice(0, 65).search(/\s+\S*$/u);
  if (boundary >= 24) end = boundary;
}
```

The 64-character window applies to this plain fallback, not to a sentence already selected by the existing scanner. Never split a word, number, Unicode character, or identifier merely to meet that window. `push()` may concatenate multiple released units in one return value; do not mis-test the returned string's total length as the per-unit window. Existing raw-input limits remain authoritative for indivisible/unfinished content.

- [x] **Step 4: Run green.** Backend: `npm test -- test/voice/agent/speech-prose.spec.ts`. Expected: all existing and new tests pass, including every-cut exact strings and the total-budget failure.

- [x] **Step 5: Commit.** Stage the two Task 1 paths and this plan's ticked checkboxes only.

```powershell
git add backend/src/voice/agent/speech-prose.ts backend/test/voice/agent/speech-prose.spec.ts docs/voice-cost-and-flow/plan3.md
git commit -m "perf(voice): release safe plain clauses at 24 characters"
```

## Task 2: Bounded evidence coalescing without speculative speech

**Files:** `backend/src/voice/agent/voice-delivery.ts`; `backend/test/voice/agent/voice-delivery.spec.ts`.

- [x] **Step 1: Append failing timing/backpressure tests.** Keep the existing `fixture()` and real-timer cleanup. Add these imports/helpers:

```typescript
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
```

```typescript
it('coalesces later clauses for 100ms and never Speaks ahead of durable generated text', async () => {
  vi.useFakeTimers();
  const f = fixture(), spoken: string[] = [];
  f.speak.mockImplementation(async command => {
    spoken.push(command.text);
    expect(f.writes.at(-1)?.textGenerated.startsWith(spoken.join(''))).toBe(true);
  });
  await f.delivery.start();
  await f.delivery.delta('First safe clause.'); await microtasks();
  expect(spoken.join('')).toBe('First safe clause.');
  expect(f.writes).toHaveLength(2); // Initial record, immediate first batch.
  for (const text of [' Next', ' safe', ' clause.']) await f.delivery.delta(text);
  await vi.advanceTimersByTimeAsync(99);
  expect(f.writes).toHaveLength(2);
  expect(spoken.join('')).toBe('First safe clause.');
  await vi.advanceTimersByTimeAsync(1);
  expect(f.writes).toHaveLength(3);
  expect(spoken.join('')).toBe('First safe clause. Next safe clause.');
  expect(f.flush).not.toHaveBeenCalled();
  await f.delivery.finish();
  expect(f.flush).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('backpressures at 512 unpersisted characters while a slow write is in flight', async () => {
  vi.useFakeTimers();
  const f = fixture(), blocked = deferred(), entered = deferred();
  await f.delivery.start();
  vi.mocked(f.write).mockImplementationOnce(async record => {
    entered.resolve(); await blocked.promise; f.writes.push(structuredClone(record));
  });
  await f.delivery.delta('A'.repeat(24)); await entered.promise;
  await f.delivery.delta('B'.repeat(487)); // 511 admitted, none durable yet.
  let accepted = false;
  const more = f.delivery.delta('CD').then(() => { accepted = true; });
  await microtasks();
  expect(accepted).toBe(false);
  expect(f.speak).not.toHaveBeenCalled();
  expect(f.writes.at(-1)?.textGenerated).toBe('');
  blocked.resolve(); await more; await vi.advanceTimersByTimeAsync(100); await f.delivery.finish();
  expect(f.speak.mock.calls.map(([c]) => c.text).join(''))
    .toBe('A'.repeat(24) + 'B'.repeat(487) + 'CD');
  expect(f.writes.at(-1)?.textGenerated.length).toBe(513);
  expect(f.flush).toHaveBeenCalledTimes(1);
});

it('requests a full 512-character batch without waiting for its 100ms timer', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  const before = f.writes.length, at = Date.now();
  await f.delivery.delta('x'.repeat(512));
  expect(Date.now()).toBe(at);
  expect(f.writes).toHaveLength(before + 1);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First.' + 'x'.repeat(512));
  await f.delivery.finish();
});

it('does not turn sustained tiny tokens into a per-token evidence write storm', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  for (let i = 0; i < 20; i++) {
    await f.delivery.delta(' x');
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(f.writes).toHaveLength(4); // Seed, first batch, 100ms batch, 200ms batch.
  await f.delivery.finish();
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First.' + ' x'.repeat(20));
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/agent/voice-delivery.spec.ts -t "coalesces later clauses|backpressures at|full 512-character|sustained tiny tokens"`. Expected: too many per-clause writes and/or the blocked first `delta()` never reaches `entered` because it still awaits durability. Temporarily set the slow-write test's timeout to 1,000 ms for the red run if necessary; restore the standard timeout for green.

- [x] **Step 3: Add one bounded accumulator and pump, not a queue of delta promises.** Add fields; initialize `generated` immediately after parsing the seed in the constructor:

```typescript
private generated: string;
private dirtySince?: number;
private generatedTimer?: ReturnType<typeof setTimeout>;
private generatedTask?: Promise<void>;
private generatedFailure?: unknown;
private textClosed = false;
private finishTask?: Promise<void>;

// Constructor, after this.record = voiceDeliveryRecordSchema.parse(seed):
this.generated = this.record.textGenerated;
```

Add these methods. Existing `enqueue`, `update`, durable `record`, progress coalescing, identity validation, and proof calculation remain in place. `drainGenerated()` is called only while holding the existing serialized action lane:

```typescript
private checkGenerated() {
  if (this.generatedFailure) throw this.generatedFailure;
}

private clearGeneratedTimer() {
  clearTimeout(this.generatedTimer);
  this.generatedTimer = undefined;
}

private async drainGenerated() {
  this.checkGenerated();
  const text = this.generated;
  this.dirtySince = undefined;
  if (text !== this.record.textGenerated) await this.update({ textGenerated: text });
  if (!this.invalid && !this.ended && text.length > this.sent.length) {
    const delta = text.slice(this.sent.length);
    this.lastProgress = Date.now();
    this.sent += delta;
    await this.speech.speak({ ...this.ref(), text: delta });
  }
}

private saveGenerated() {
  this.clearGeneratedTimer();
  if (this.generatedTask) return this.generatedTask;
  const task = this.enqueue(() => this.drainGenerated()).catch(error => {
    this.generatedFailure ??= error;
    this.invalidate();
    throw error;
  }).finally(() => {
    if (this.generatedTask === task) this.generatedTask = undefined;
    if (!this.invalid && !this.generatedFailure && this.generated !== this.record.textGenerated)
      this.scheduleGenerated();
  });
  this.generatedTask = task;
  return task;
}

private scheduleGenerated() {
  if (this.generatedTimer || this.generatedTask || this.ended) return;
  const due = this.generated.length - this.record.textGenerated.length >= 512 ? 0
    : Math.max(0, 100 - (Date.now() - (this.dirtySince ?? Date.now())));
  this.generatedTimer = setTimeout(() => {
    this.generatedTimer = undefined;
    void this.saveGenerated().catch(() => undefined);
  }, due);
}

private async drainAllGenerated() {
  do {
    await this.saveGenerated();
    this.checkGenerated();
  } while (!this.ended && this.generated !== this.record.textGenerated);
}
```

Replace `delta()` with bounded admission. The normal runtime is already a single awaited producer; do not add concurrent producers or a collection of closures holding their text. The accumulator includes the in-flight snapshot in its 512-character cap because `record` advances only after the write succeeds. Large incoming deltas are admitted in bounded slices; this buffering boundary adds **no whitespace, punctuation, or Flush**, and is not a new prose segmentation rule. Avoid cutting a surrogate pair:

```typescript
async delta(text: string) {
  this.checkGenerated();
  if (this.invalid || this.ended || !text) return;
  if (this.textClosed) throw new AppError('INVALID_REQUEST', 'Speech generation has ended.');
  voiceDeliveryRecordSchema.parse({ ...this.record, textGenerated: this.generated + text });
  for (let offset = 0; offset < text.length;) {
    this.checkGenerated();
    if (this.invalid || this.ended) return;
    const room = 512 - (this.generated.length - this.record.textGenerated.length);
    let end = Math.min(text.length, offset + room);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? '') &&
      /[\uDC00-\uDFFF]/u.test(text[end])) end--;
    if (end === offset) { await this.saveGenerated(); continue; }
    this.generated += text.slice(offset, end);
    this.dirtySince ??= Date.now();
    offset = end;
    // ponytail: one 512-character unpersisted suffix and one writer; a slow store backpressures the existing awaited producer rather than creating a text queue.
    if (this.generated.length - this.record.textGenerated.length >= 512) await this.saveGenerated();
    else if (!this.sent && !this.record.textGenerated) void this.saveGenerated().catch(() => undefined);
    else this.scheduleGenerated();
  }
}
```

Do not mutate the persisted `record.textGenerated` optimistically; its sequence/event identity must remain the last acknowledged durable snapshot. Every Speak stays inside the lane after `update()` succeeds. While a write runs, later accepted text stays in the same bounded suffix; its next snapshot is requested at its original dirty deadline/cap, not once per token or automatically after every short write. Only terminal `drainAllGenerated()` bypasses that intentional coalescing wait. No background save failure is discarded: the catch stores it and invalidates delivery before swallowing the background promise's rejection.

- [x] **Step 4: Make existing immediate-record assertions await the real drain barrier, without relaxing their safety invariant.** In the first existing delivery test, move `await f.delivery.finish()` immediately after its first `delta` and before inspecting durable text; it must still expect `Hello world.`. The new Speak spy asserts durability **at dispatch**, which is stronger than inspecting a record after both operations. Leave played-sample completion, malformed evidence, stall budgets, and unknown settlement assertions unchanged. Task 3 adds terminal barriers before running the whole file.

- [x] **Step 5: Run green for this task.** Backend: `npm test -- test/voice/agent/voice-delivery.spec.ts -t "coalesces later clauses|backpressures at|full 512-character|sustained tiny tokens"`. Expected: pass, bounded live dirty suffix, one initial record, no per-token writes, zero speculative Speak. Record actual write counts and virtual dispatch times in the worker handoff.

- [x] **Step 6: Commit the two delivery files and ticked plan.**

```powershell
git add backend/src/voice/agent/voice-delivery.ts backend/test/voice/agent/voice-delivery.spec.ts docs/voice-cost-and-flow/plan3.md
git commit -m "perf(voice): coalesce bounded generated evidence before speech"
```

## Task 3: Terminal drains, persistence failures, and exactly one final Flush

**Files:** the two delivery files from Task 2.

- [x] **Step 1: Append failing terminal/failure tests.** Helpers from Task 2 are reused.

```typescript
it('drains the last clause before one final Flush even when finish is repeated', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  await f.delivery.delta(' Last clause.');
  f.flush.mockImplementation(async () => {
    expect(f.writes.at(-1)?.textGenerated).toBe('First. Last clause.');
    expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First. Last clause.');
  });
  await Promise.all([f.delivery.finish(), f.delivery.finish()]);
  expect(f.flush).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('persists a cancelled dirty suffix without dispatching it or flushing old speech', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('Hello world.'); await microtasks();
  await f.delivery.delta(' Unheard dirty suffix.');
  f.delivery.invalidate();
  await f.delivery.event({ type: 'speech-interrupted', turnId: f.seed.turnId,
    responseId: f.seed.responseId, speechId: 'speech-1', audioPlayedMs: 50,
    textSpoken: 'Hello', textRemaining: ' world.', usage });
  await f.delivery.finish(); await f.delivery.settle('Hello world. Unheard dirty suffix.');
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('Hello world.');
  expect(f.flush).not.toHaveBeenCalled();
  expect(f.writes.at(-1)).toMatchObject({ status: 'interrupted', textSpoken: 'Hello',
    textRemaining: ' world. Unheard dirty suffix.' });
  expect(vi.getTimerCount()).toBe(0);
});

it('fences every later Speak after a timer-driven evidence failure and exposes the failure at settle', async () => {
  vi.useFakeTimers(); const f = fixture(), failure = new Error('fixture evidence failure');
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  vi.mocked(f.write).mockRejectedValueOnce(failure);
  await f.delivery.delta(' Unsaved.');
  await vi.advanceTimersByTimeAsync(100);
  await expect(f.delivery.delta(' Never speak.')).rejects.toBe(failure);
  await expect(f.delivery.finish()).rejects.toBe(failure);
  await expect(f.delivery.settle('First. Unsaved.')).rejects.toBe(failure);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First.');
  expect(f.flush).not.toHaveBeenCalled();
  expect(f.writes.at(-1)?.status).toBe('pending'); // Reconciliation must not see false completion.
  expect(vi.getTimerCount()).toBe(0);
});

it('does not synthesize twice when settle follows a drained Unicode batch', async () => {
  const f = fixture(), text = 'x'.repeat(511) + '🌍 tail';
  await f.delivery.start(); await f.delivery.delta(text); await f.delivery.finish();
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId,
    responseId: f.seed.responseId, speechId: 'speech-1', audioDurationMs: 100,
    audioSamples: 2400, usage });
  await f.delivery.playback(2400); await f.delivery.settle(text);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe(text);
  expect(f.speak.mock.calls.every(([c]) => !/[\uD800-\uDBFF]$/u.test(c.text))).toBe(true);
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', textSpoken: text });
  expect(f.flush).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/agent/voice-delivery.spec.ts -t "last clause|cancelled dirty|timer-driven|Unicode batch"`. Expected: repeated finish flushes twice and/or the old finish/settle never drains dirty text. Do not treat an unhandled rejection as the intended failure; background save failures must be latched and observed.

- [x] **Step 3: Replace `invalidate`/`finish` with terminal-safe barriers.** Existing public signatures stay compatible; cancellation remains synchronous and immediately disables Speak.

```typescript
invalidate() {
  this.invalidAt ??= Date.now();
  this.invalid = true;
  this.clearGeneratedTimer();
  this.wake?.();
  if (!this.generatedFailure && !this.ended && this.generated !== this.record.textGenerated)
    void this.drainAllGenerated().catch(() => undefined);
}

finish() {
  this.textClosed = true;
  return this.finishTask ??= (async () => {
    await this.drainAllGenerated();
    this.checkGenerated();
    await this.enqueue(async () => {
      if (!this.invalid && !this.ended && this.sent) {
        try { await this.speech.flush(this.ref()); }
        catch (error) { this.invalidate(); throw error; }
      }
    });
  })();
}
```

At the beginning of `settle`'s existing `try`, drain before the existing initial serialized validation. Compare the terminal source against **all accepted generated text**, not only its previously durable prefix. The completion wait/proof/deadlines and final durable status are retained:

```typescript
await this.drainAllGenerated();
this.checkGenerated();
await this.enqueue(async () => {
  if (this.playbackFailure) throw this.playbackFailure;
  if (!finalGenerated.startsWith(this.generated))
    throw new AppError('NOT_READY', 'Generated speech evidence disagrees.');
  if (finalGenerated !== this.record.textGenerated) await this.update({ textGenerated: finalGenerated });
  this.generated = finalGenerated;
});
```

Replace only the old initial `settle` validation block with that code; do not retain a second copy. Its existing `finally` becomes:

```typescript
} finally {
  this.clearGeneratedTimer();
  signal?.removeEventListener('abort', abort);
}
```

Inside `event`'s existing `speech-interrupted` branch, after binding checks and before the usual event update, retain the interruption and persist dirty generated text **inside the current lane**. Calling `saveGenerated()` and awaiting it from inside an enqueued action would deadlock; use the internal drain:

```typescript
if (e.type === 'speech-interrupted') {
  this.interrupted ??= e;
  this.invalidate();
  await this.drainGenerated();
}
```

Do not change `proof()` to infer words from elapsed time or received bytes. If evidence writes fail, the existing outer adapter/runtime failure/reconciliation path owns disposition; leave the last durable status pending/unknown rather than manufacturing completion or replaying speech. All async save errors are latched; subsequent delta/finish/settle observes them. Initial `start()` still awaits the initial record before model output.

- [x] **Step 4: Preserve the meaning of existing regressions under admitted-versus-dispatched delta semantics.** Where a test invalidates immediately after `await delta`, add `await microtasks()` **only when that fixture means the earlier Speak has already happened** (existing interrupted-evidence, unknown-timeout, malformed-split, stall, and actual-Speak-clock tests). Do not drain a dirty suffix that a cancellation test intentionally leaves unsent. In `coalesces progress during a slow evidence write`, add `await f.delivery.finish()` before installing the slow playback write, so the artificial delay still targets playback, not a pending generated write. Its existing pending-playback write-count assertion remains three. Add `await microtasks()` after the initial delta in the long-thinking stall test before starting its settlement clock. Retain every existing exact-sample/proof/unknown assertion.

- [x] **Step 5: Run green and the caller regressions.** Backend:

```powershell
npm test -- test/voice/agent/voice-delivery.spec.ts test/voice/agent/speech-prose.spec.ts test/voice/agent
npm test -- test/voice/session/live.spec.ts test/voice/providers/flux-tts.spec.ts
```

Expected: all discovered deterministic tests pass, one Flush at genuine finish, none at cancel/failure, no private prose leakage, no guessed heard prefix, no remaining batching timer after terminal cleanup. Existing native-skipped tests are reported as skipped, not passed.

- [x] **Step 6: Commit.**

```powershell
git add backend/src/voice/agent/voice-delivery.ts backend/test/voice/agent/voice-delivery.spec.ts docs/voice-cost-and-flow/plan3.md
git commit -m "fix(voice): drain coalesced evidence on terminal delivery paths"
```

## Task 4: Actual live-runtime timing regression, not just a delivery mock

**Files:** Create `backend/test/runtime/voice-output.spec.ts`. Inspect but normally do not edit `backend/src/chat-runtime/durable-chat-runtime.ts`.

- [x] **Step 1: Write the direct runtime regression.** This uses the real existing runtime, model SSE parser, prose filter, delivery tracker, and MemorySaver, with in-memory persistence and provider bytes. Include this header and test:

```typescript
/**
 * ============================================================================
 * FILE: voice-output.spec.ts
 * LOCATION: backend/test/runtime/voice-output.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify safe live text cadence and durable speech batching without services.
 * ROLE IN PROJECT:
 *    Exercises DurableChatRuntime's live delta/finish/settle path with real prose
 *    filtering and delivery tracking plus a deliberately slow evidence writer.
 * KEY COMPONENTS:
 *    - Controlled SSE fixture and exact durable-before-Speak trace.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { chunk, usage as modelUsage, done } from '../fixtures/openrouter/frames.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import type { LiveExecution } from '../../src/chat-runtime/ports.js';

afterEach(() => vi.useRealTimers());

it('delivers split safe live text before model completion despite 25ms evidence writes', async () => {
  vi.useFakeTimers();
  const h = textConfigFixture(textSnapshot(1)), encoder = new TextEncoder();
  let resolveFetched!: () => void;
  const fetched = new Promise<void>(resolve => { resolveFetched = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  h.fetcher.mockImplementationOnce(async () => {
    resolveFetched(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const records: VoiceDeliveryRecord[] = [], spoken: string[] = [];
  const trace: Array<{ stage: string; at: number }> = [];
  h.p.metadata.putVoiceDelivery = async r => { records.push(structuredClone(r)); };
  h.p.metadata.compareVoiceDelivery = async (r, expected) => {
    expect(records.at(-1)?.sequence).toBe(expected);
    trace.push({ stage: 'write-start', at: Date.now() });
    await new Promise<void>(resolve => setTimeout(resolve, 25));
    records.push(structuredClone(r));
    trace.push({ stage: 'write-end', at: Date.now() });
    return true;
  };
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-output-fixture', owner: { kind: 'live', voiceSessionId: 'v-output' } });
  let delivery!: VoiceDelivery;
  const flush = vi.fn(async () => undefined);
  const live: LiveExecution = {
    reservation,
    start: async (a, write) => {
      const seed = { ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId, voiceSessionId: 'v-output',
        turnId: a.turnId, attemptId: a.attemptId, status: 'pending' as const,
        textGenerated: '', textSpoken: null, textRemaining: null,
        audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
      delivery = new VoiceDelivery(seed, 0, write, { flush, speak: async c => {
        spoken.push(c.text);
        expect(records.at(-1)?.textGenerated.startsWith(spoken.join(''))).toBe(true);
        trace.push({ stage: 'speak', at: Date.now() });
      } }, 2000);
      await delivery.start();
    },
    delta: text => delivery.delta(text), finish: () => delivery.finish(),
    settle: async text => {
      const ref = records.at(-1)!;
      await delivery.event({ type: 'speech-completed', turnId: ref.turnId,
        responseId: ref.responseId, speechId: 'speech-output', audioDurationMs: 100,
        audioSamples: 2400, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: 100, billableCharacters: text.length } });
      await delivery.playback(2400); await delivery.settle(text);
    },
  };
  let running: Promise<void> | undefined;
  try {
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-output-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please answer.', idempotencyKey: 'voice-output-key' });
    running = h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, live });
    await fetched;
    controller.enqueue(encoder.encode(chunk('<thi')));
    controller.enqueue(encoder.encode(chunk('nk>private hidden reasoning.</think>Keep every word in orde')));
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken).toEqual([]);
    controller.enqueue(encoder.encode(chunk('r ')));
    await vi.advanceTimersByTimeAsync(25);
    expect(spoken.join('')).toBe('Keep every word in order');
    expect(flush).not.toHaveBeenCalled(); // Provider has not completed the model response.
    controller.enqueue(encoder.encode(chunk('and preserve demo_id exactly ₹12.50')));
    await vi.advanceTimersByTimeAsync(99);
    expect(spoken.join('')).toBe('Keep every word in order');
    await vi.advanceTimersByTimeAsync(26);
    expect(spoken.join('')).toBe('Keep every word in order and preserve demo_id exactly');
    controller.enqueue(encoder.encode(chunk('', 'stop') + modelUsage + done));
    controller.close();
    await vi.advanceTimersByTimeAsync(250);
    await running;
    expect(flush).toHaveBeenCalledTimes(1);
    expect(records.at(-1)).toMatchObject({ status: 'completed',
      textSpoken: 'Keep every word in order and preserve demo_id exactly ₹12.50' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(trace.find(t => t.stage === 'speak')!.at)
      .toBeGreaterThanOrEqual(trace.find(t => t.stage === 'write-end')!.at);
  } finally {
    if (running) {
      await vi.advanceTimersByTimeAsync(30000);
      await running.catch(() => undefined);
    }
    await h.dispose();
  }
});
```

The `finally` intentionally advances the finite run timeout so a failed pre-completion assertion cannot strand an open fixture stream. Capture and assert first write/first Speak timestamps, the 100 ms later-batch request, final exact content, and one inference. Do not add external services to make this test run. The fixture's otherwise-stubbed delivery methods are replaced locally, not by editing the shared fixture.

- [x] **Step 2: Establish the red counterfactual without reverting other work.** The new earlier-cadence assertion fails against the original 96-character filter, and the 99 ms no-extra-Speak assertion fails against original per-clause `delta()` writes. By this task those fixes are present: temporarily change **only the worker's own** fallback threshold from 24 back to 96, run `npm test -- test/runtime/voice-output.spec.ts -t "split safe live text"`, observe the first early-Speak assertion fail, then restore 24 with the patch tool. Do not use `git checkout`, reset, switch branches, or revert a shared commit.

- [x] **Step 3: Keep the minimal runtime implementation: its existing awaits.** These are the relevant existing lines; leave their ordering intact:

```typescript
if (text) { partial += text; await c.live?.delta(text); await emit({ type: 'delta', text }); }
if (tail) { partial += tail; await c.live?.delta(tail); await emit({ type: 'delta', text: tail }); }
await c.live?.finish();
// Existing finally, before releasing the lease:
await c.live.settle(finalGenerated, job.signal);
```

There is no second asynchronous queue in the runtime and no need to remove its awaits now that delivery admission is bounded and decoupled from each individual write. Never move Flush into `delta` or sentence processing. A fixture-discovered issue outside these scoped output boundaries goes back to its owner through the orchestrator.

- [x] **Step 4: Verify green.** Backend: `npm test -- test/runtime/voice-output.spec.ts test/runtime/text-config.spec.ts test/runtime/accounting-completion.spec.ts test/voice/agent`. Expected: all discovered tests pass; text configuration/finalization behavior is unchanged. Record the deterministic 25 ms first write delay separately from coalescing, model starvation, and provider/audio latency. This fixture does not measure a real database or acoustics.

- [x] **Step 5: Commit.**

```powershell
git add backend/test/runtime/voice-output.spec.ts docs/voice-cost-and-flow/plan3.md
git commit -m "test(voice): verify live safe-text cadence with slow evidence"
```

## Task 5: One 100 ms playback origin and payload-free scheduling observations

**Files:** `frontend/src/features/voice/audio/audio-playback-service.ts`; its existing test.

- [x] **Step 1: Append the failing startup/origin test.** It uses the existing `pcm` and `FakeContext`.

```typescript
it('reserves 100ms once per response independently of its explicit sample origin', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext());
  await p.unlock(); p.begin('t1', 'r1', 0);
  p.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(600) });
  p.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 25, pcm: pcm(2400) });
  expect(context.sources.map(n => n.start.mock.calls[0][0])).toEqual([0.1, 0.125]);
  context.currentTime = 0.099;
  expect(p.progress().playedSamples).toBe(0);
  context.currentTime = 0.125;
  expect(p.progress().playedSamples).toBe(600);
  expect(p.observations()).toEqual({ turnId: 't1', responseId: 'r1',
    startupReserveMs: 100, underruns: 0, underrunMs: 0 });
  p.interrupt(); p.begin('t2', 'r2', 3000);
  p.enqueue('r2', { kind: 2, flags: 0, sequence: 2, offsetMs: 125, pcm: pcm(4800) });
  expect(context.sources[2].start.mock.calls[0][0]).toBe(0.225);
  expect(p.observations().startupReserveMs).toBe(100); // Long initial packet still gets one reserve.
});
```

- [x] **Step 2: Run red.** Frontend: `npm test -- src/features/voice/audio/audio-playback-service.test.ts -t "reserves 100ms"`. Expected: starts at zero and/or `observations` is missing. Use existing fake clocks, not a real AudioContext.

- [x] **Step 3: Add separate startup and observation state.** Do not reuse `firstPacket`: `begin(..., origin)` deliberately sets that flag false for sample-offset validation, not for playback timing.

```typescript
private startupPending = true
private startupReserveMs = 0
private underruns = 0
private underrunSamples = 0
```

After `begin` has passed its existing idle/origin checks, initialize its scheduling fields before accepting audio:

```typescript
this.nextTime = this.context?.currentTime ?? 0
this.startupPending = true
this.startupReserveMs = 0
this.underruns = 0
this.underrunSamples = 0
```

Replace only `const start = Math.max(context.currentTime, this.nextTime)` in `enqueue` with:

```typescript
const gapSamples = this.startupPending ? 0
  : Math.round(Math.max(0, context.currentTime - this.nextTime) * 24000)
if (gapSamples > 0) {
  this.underruns++
  this.underrunSamples += gapSamples
}
// ponytail: one fixed 100ms response-start reserve, never a packet/sentence delay; adaptive rebuffering needs separate measured authorization.
const start = Math.max(context.currentTime, this.nextTime) + (this.startupPending ? 0.1 : 0)
if (this.startupPending) this.startupReserveMs = 100
this.startupPending = false
```

Keep `source.start(start)` and `nextTime = start + samples / 24000`, all PCM samples, decoding, queue checks, output-latency-aware `audibleTime`, and exact offset validation. An empty first packet does not consume the reserve because the existing `if (!samples) return true` precedes this code. Add this local inspection method, without extending any network event or controller API:

```typescript
observations() {
  return { ...this.ref, startupReserveMs: this.startupReserveMs,
    underruns: this.underruns, underrunMs: this.underrunSamples / 24 }
}
```

These are per-response scheduler observations, not acoustic measurements, payload logs, a new metrics system, or claims that PCM contains no intentional silence. They are available for P4's fixture reports without editing P1's flow or P2's controller. Leave the old response's observations readable after interrupt; a successful next `begin` resets them.

- [x] **Step 4: Update existing scheduling expectations, not evidence semantics.** In the original first test expect starts `[0.1, 0.2]`, zero played samples at `0.05`, 1,200 at `0.15`, and 200 ms after `0.35`. The late packet at 10 seconds still starts at 10 seconds; 10.05 yields a cumulative cursor of 250 ms, not another reserve. In the interrupt test change the first observation from `0.05` to `0.15` (still 50 ms actually played), and the second response observation to `0.30` (its new start is `0.25`, yielding the same absolute 250 ms cursor). In the drain test move the final drained clock from `0.1` to `0.2`. Keep overflow, unlock, stale-response, explicit-origin, decoding, and repeated-dispose expectations.

- [x] **Step 5: Run green.** Frontend: `npm test -- src/features/voice/audio/audio-playback-service.test.ts`. Expected: one 100 ms origin per response, unchanged sample meaning, queue overflow still stops old nodes, no reserve counted as heard audio.

- [x] **Step 6: Commit.**

```powershell
git add frontend/src/features/voice/audio/audio-playback-service.ts frontend/src/features/voice/audio/audio-playback-service.test.ts docs/voice-cost-and-flow/plan3.md
git commit -m "perf(voice): add one bounded playback startup reserve"
```

## Task 6: Bursty PCM, recoverable jitter, underruns, and immediate interruption

**Files:** the playback test; only its owned service if these new assertions expose a genuine scheduling defect. No fake/capture/controller changes.

- [x] **Step 1: Add deterministic fixture schedules and exact proof tests.** Each arrival is seconds on the Web Audio scheduling clock; each packet contains exactly 2,400 samples/100 ms. There are no wall-clock sleeps or provider calls.

```typescript
it('absorbs recoverable delivery jitter without inserting packet or sentence gaps', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext());
  await p.unlock(); p.begin('t', 'r');
  for (const [i, at] of [0, 0.19, 0.2, 0.39].entries()) {
    context.currentTime = at;
    p.enqueue('r', { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) });
  }
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number);
  for (let i = 0; i < starts.length; i++) expect(starts[i]).toBeCloseTo(0.1 + i * 0.1, 9);
  expect(p.observations()).toMatchObject({ startupReserveMs: 100, underruns: 0, underrunMs: 0 });
  p.end('r'); context.currentTime = 0.5;
  expect(p.isDrained()).toBe(true);
  expect(p.progress()).toMatchObject({ playedSamples: 9600, playedMs: 400, consumedSamples: 9600 });
});

it('reports actual scheduler starvation instead of hiding it with another startup delay', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext());
  await p.unlock(); p.begin('t', 'r');
  for (const [i, at] of [0, 0.25, 0.26].entries()) {
    context.currentTime = at;
    p.enqueue('r', { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) });
  }
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number);
  expect(starts[0]).toBeCloseTo(0.1, 9);
  expect(starts[1]).toBeCloseTo(0.25, 9);
  expect(starts[2]).toBeCloseTo(0.35, 9);
  expect(p.observations()).toMatchObject({ startupReserveMs: 100, underruns: 1, underrunMs: 50 });
});

it('keeps bursty PCM sample-contiguous and stops reserved audio before it is audible', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext(), 400);
  await p.unlock(); p.begin('t1', 'r1');
  for (let i = 0; i < 4; i++) p.enqueue('r1', {
    kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) });
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number);
  for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(0.1, 9);
  context.currentTime = 0.05;
  expect(p.interrupt()).toMatchObject({ playedSamples: 0, consumedSamples: 0 });
  expect(context.sources.every(n => n.stop.mock.calls.length === 1)).toBe(true);
  expect(p.enqueue('r1', { kind: 2, flags: 0, sequence: 4, offsetMs: 400, pcm: pcm(2400) })).toBe(false);
  expect(p.isDrained()).toBe(true);
  p.begin('t2', 'r2', 9600);
  p.enqueue('r2', { kind: 2, flags: 0, sequence: 5, offsetMs: 400, pcm: pcm(1) });
  context.currentTime = 0.15;
  expect(p.progress()).toMatchObject({ playedSamples: 9600, consumedSamples: 0 });
  context.currentTime = 0.15 + 1 / 24000;
  expect(p.progress()).toMatchObject({ playedSamples: 9601, consumedSamples: 1 });
});

it('preserves PCM silence and never substitutes reserve time for sample evidence', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext());
  await p.unlock(); p.begin('t', 'r');
  p.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) });
  expect([...context.sources[0].buffer!.getChannelData(0)].every(n => n === 0)).toBe(true);
  context.currentTime = 0.1;
  expect(p.progress().playedSamples).toBe(0);
  context.currentTime = 0.1 + 2399 / 24000;
  expect(p.progress().playedSamples).toBe(2399);
  context.currentTime = 0.2;
  expect(p.progress().playedSamples).toBe(2400);
  expect(p.observations().underruns).toBe(0);
});
```

- [x] **Step 2: Demonstrate the red timing counterfactual without undoing concurrent changes.** Temporarily change only the worker's new startup addend from `0.1` to `0` using the patch tool. Frontend: `npm test -- src/features/voice/audio/audio-playback-service.test.ts -t "recoverable delivery jitter"`. Expected: late starts/gaps and nonzero underruns. Restore `0.1` immediately; no git restore/reset/checkout. If a new test is already green with Task 5, do not invent a production change merely to give it a red run.

- [x] **Step 3: Retain the Task 5 minimum implementation.** All later starts remain `max(currentTime, previousEnd)`, with no additional 100 ms hold. If numeric comparison requires attention, keep integer sample rounding for the observation and tolerance-based float comparisons in tests; never change actual audio speed, buffer contents, or the exact-sample progress formula to satisfy a float assertion. Existing two-second/configured PCM queue bounds remain intact; the reserve adds exactly 100 ms to scheduling lead, not extra retained PCM or an indefinite rebuffer queue.

- [x] **Step 4: Run green.** Frontend: `npm test -- src/features/voice/audio/audio-playback-service.test.ts`. Expected fixture report: recoverable jitter 100 ms startup/zero underruns; starvation fixture 100 ms startup/one 50 ms underrun; same-time burst no application-inserted gap; reserve interrupted at 50 ms produces zero heard samples; submillisecond playback stays sample-exact.

- [x] **Step 5: Commit.** Include the service path only if this task required a P3 correction; never stage untouched/unrelated files to hide their ownership.

```powershell
git add frontend/src/features/voice/audio/audio-playback-service.test.ts docs/voice-cost-and-flow/plan3.md
git commit -m "test(voice): cover playback jitter starvation and reserved cancellation"
```

## Task 7: Verification and P4 handoff

**Files:** This plan's checkboxes only; implementation defects stay in their assigned P3 files and get a focused regression before correction. P4 owns final feature verification/report documents.

- [x] **Step 1: Run the complete focused output path.** Backend:

```powershell
npm test -- test/voice/agent test/runtime/voice-output.spec.ts test/voice/providers/flux-tts.spec.ts test/voice/session/live.spec.ts
```

Frontend:

```powershell
npm test -- src/features/voice/audio/audio-playback-service.test.ts
```

Expected: all discovered deterministic output tests pass. Inspect test counts: zero tests is not evidence. Preserve provider Flush, generated/heard distinction, identity/sequence fencing, cancelled old-response discarding, and scope-specific regression results.

- [x] **Step 2: Run package checks separately and record actual results.** Backend: `npm run build`, `npm run lint`, `npm test`. Frontend: `npm run build`, `npm run lint`, `npm test`. Do not chain commands or treat one package's success as the other's. A P2/P4-owned failure is reported to its owner with command, file, and error; do not edit their files or relax shared guards. Re-run affected checks after an owner commits a fix.

- [x] **Step 3: Report prerequisites honestly.** `npm run test:e2e` and native voice suites require operator-provided `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never fill these from application `.env` or point a fixture at application/production data. Report absent prerequisites as skipped/blocked. Do not run live/behavior calls, real microphone capture, listening tests, billing probes, service provisioning, or deployments. AC8 acoustic quality, false decisions, actual provider usage/savings, and real p50/p95 first-audible response remain unverified until separately authorized.

- [x] **Step 4: Self-check the named diff and commit bookkeeping.** At repository root run `git diff --check` and inspect `git status --short`, `git diff --name-only`, and `git diff --cached --name-only`. Confirm no `live-flow.ts`, TTS/capture/controller/app wiring, canvas, package, secret, generated output, or unrelated file is staged. Check every completed task checkbox and retain all plan constraints. Any final source correction gets its own named-path regression/commit before the documentation-only bookkeeping commit:

```powershell
git add docs/voice-cost-and-flow/plan3.md
git commit -m "test(voice): complete continuous output regression checks"
```

- [x] **Step 5: Send a concise result to the orchestrator.** Include all P3 commit hashes; exact checks/test counts/skips; 24-character release fixture; first-write and first-Speak ordering/timing; 100 ms/512-character batching/backpressure; initial record/failure/finish/cancel/settle results; one final Flush; 100 ms per-response startup reserve; jitter/underrun observations; exact played samples and immediate old-audio invalidation. Highlight the deliberate durability interpretation above and unchanged runtime await contract. P4 can then integrate backend observation hooks with these local scheduler observations without transferring P1/P2 ownership. Do not claim the workflow complete, review passed, acoustic gaps diagnosed, or invoice savings certified.

## Acceptance mapping and self-check

| Criterion | Task / evidence |
| --- | --- |
| AC5: Earlier safe text and split/slow tokens | Tasks 1 and 4: 24-character boundary, arbitrary cuts, controlled SSE before model end. |
| AC5: Slow evidence, finite queue, no speculative speech | Tasks 2–4: 25 ms writer, timer/cap, blocked 513th character, write-before-Speak trace, one producer. |
| AC5: Sentence/packet continuity, bursty PCM, recoverable jitter | Tasks 5–6: one 100 ms origin, exact subsequent sample scheduling, zero artificial packet/sentence hold. |
| AC5: Report reserve and underruns rather than hiding slow synthesis | Tasks 5–7: local observations and exact 50 ms starvation fixture; no adaptive buffering. |
| AC6: Safe content, one Flush, order, bounded text | Tasks 1–4: existing guard oracle, unchanged total limit, one final Flush, exact concatenated text, Unicode slice safety. |
| AC6: Cancel, failed durability, played versus generated, terminal persistence | Tasks 2–4 and 6: dirty-cancel drain, latched failure, exact proof, actual runtime finalization, reserve invalidation. |
| AC6: Mute privacy and Flux-authorized interruption | P1/P2 retain ownership; run existing live-flow/provider regressions in Tasks 3 and 7. P3 never turns mute into a local playback restart or detector-triggered interrupt. |
| AC7 | Task 7 package checks; P4 integrated verification; native skips separate. |
| AC8 | Explicitly unauthorized/unrun; no acoustic or billing certification. |

Planner self-check: P3-only file map, seven checkbox-tracked tasks, concrete failing test code/commands, implementation snippets, terminal/failure bounds, explicit durability decision, and commit instructions are present. No source implementation or runtime/provider/device verification was performed to create this document.
