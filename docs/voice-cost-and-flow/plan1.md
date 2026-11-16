# Shared Pause/Resume Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide strictly validated live-input suspension and same-call recovery while retaining finite server budgets, manual-mute privacy, exactly-once completed-turn submission, and honest usage evidence.

**Architecture:** Extend the existing portable wire contract, Flux adapter, live flow, session registry, and usage lease rather than adding a service or setting. Ordinary suspension gates only input and settles Flux once; a provider/resource pause disposes paid work but retains the admitted session and transport control surface. Resume reuses that admission and its original deadlines, and never submits speech, resets quota, or manufactures a conversation.

**Tech Stack:** TypeScript ESM/NodeNext, existing NestJS session composition, native `ws` ping/pong, Zod 3, Vitest 4, and the existing browser protocol mirror. No new dependency.

---

I'm using the writing-plans skill to create this implementation plan. This artifact is planning only; implementation has not started.

## Steps

- [x] Task 1: Establish strict suspend/terminal wire contracts and update existing emitters.
- [x] Task 2: Preserve stored settings without an obsolete idle-exit constraint.
- [x] Task 3: Make Flux finalization idempotent and provider-settled; prove ping-only quiet.
- [x] Task 4: Suspend input without cancelling output; preserve manual-mute privacy.
- [x] Task 5: Bound finalization and safely renew a retired STT generation without inference.
- [x] Task 6: Remove idle teardown, retain absolute budgets, and report incomplete usage honestly.
- [x] Task 7: Retain admitted sessions on policy stops and enforce budget checks on resume.
- [x] Task 8: Pause/reopen paid flows on the existing control connection, not a new session.
- [x] Task 9: Execute the P1 regression/verification gate and report downstream contracts.

## Scope, ownership, and constraints

Read `AGENTS.md`, `goal.md`, `research.md`, and `state.md` before execution. This plan is P1 only. Its starting research/DAG commits are `1490473` / `9735926`; those are planning inputs, not passing implementation evidence. Unified review remains **skipped**, not passed. Do not dispatch a reviewer.

Do not edit P2 capture/detector/packages, live controller/reducer/panel, P3 prose/delivery/playback/runtime output, or P4 `backend/src/app.service.ts` and integration suites. P2 implements the five-second detector and persistent browser surface after this worker is committed; P1 cannot claim mounted-UI acceptance by backend tests alone. P3 uses existing output observation hooks and must not edit `live-flow.ts`.

**Necessary caller ripple, not another feature:** `VoiceConnection` constructs required terminal events and currently hard-couples every usage stop to socket disposal. Its direct lifecycle changes and `gateway.spec.ts` therefore belong with P1's session/sink contract. `DictationFlow` needs only the required `terminal: true` additions; no dictation behavior changes. The frontend shared fixture catalog and admin field validation/copy are contract/config mirrors, not P2 call UI. This resolves the otherwise unassigned transport-emitter ownership gap; notify the orchestrator in the worker handoff.

No new resume event, setting, parser, Flush, database schema/migration, silent PCM, or repeated inference. Keep protocol version 1 because backend/browser are released together; missing `terminal` is rejected, not silently defaulted. Retain the old positive idle config fields as stored compatibility data; they no longer authorize a hang-up. Existing `eotTimeoutMs` is not the upload-gate timer.

Use existing file headers. Every new test file below includes its header before imports; modified files already have headers. Backend local imports use `.js`; frontend imports follow the existing local style. Use existing fixtures/Vitest, no new harness framework. A deliberate bound gets a `ponytail:` comment with its ceiling and upgrade path. Stage named task paths only. Tick completed coarse steps and their checkboxes in this file; do not rewrite its constraints or edit the orchestrator's state records.

All commands below are PowerShell-compatible, run from the explicitly stated package directory unless a command says repository root. Do not chain shell commands with separators. Use Node in the repository's admitted range. Never read/print keys, perform paid/provider requests, capture a microphone, provision/deploy, or substitute the application database. Native test guards remain unchanged: absent `AURVIN_TEST_MONGODB_URI` means skip, and the only admitted prefix is `aurvin_p2_test_` with generated isolated databases.

## File map

| Files | Responsibility |
| --- | --- |
| `backend/src/contracts/voice-wire.ts`, `frontend/src/api/voice-protocol.ts` | Identical portable types/guards after their headers; suspend, recovery, terminal flags, legacy limit compatibility. |
| `backend/src/contracts/voice.spec.ts`, `backend/src/contracts/testing/voice-fixtures.ts`, `backend/src/contracts/testing/voice-fixtures.spec.ts`, `frontend/src/api/voice-protocol.test.ts`, `frontend/src/api/testing/voice-fixtures.ts`, `frontend/src/api/testing/voice-fixtures.test.ts` | Strict wire and mirrored fixture checks. |
| `backend/src/contracts/voice.ts` | Existing STT `finalize()`/`finalized` semantics documented, without adding another event family. |
| `backend/src/voice/providers/flux-stt.ts`, `backend/test/voice/providers/flux-stt.spec.ts` | One pending ForceEndTurn, acknowledgement/no-active-turn settlement, no partial promotion. |
| `backend/test/voice/providers/resilience.spec.ts` | Existing provider harness proves pings with no audio/KeepAlive. No `ProviderLink` source change is needed. |
| `backend/src/voice/session/live-flow.ts`, `backend/test/voice/session/live.spec.ts`, `backend/test/voice/session/fixtures.ts` | Input suspend/mute, bounded finalization, fenced one-shot STT renewal; output behavior remains intact. |
| `backend/src/voice/session/voice-session.options.ts`, `backend/src/voice/session/voice-session.service.ts`, `backend/test/voice/session/controller.spec.ts` | Same admission/reservation, policy block, original duration and resumability guard. |
| `backend/src/voice/transport/voice-connection.ts`, `backend/test/voice/transport/gateway.spec.ts` | Required terminal emitters and control-only paid-work pause/reopen. Preserve framing/cursors/origin checks. |
| `backend/src/voice/session/dictation-flow.ts`, `backend/test/voice/session/dictation.spec.ts` | Mechanical required-terminal compatibility only. |
| `backend/src/voice/usage/voice-usage.service.ts`, `backend/test/voice/usage/quota.spec.ts`, `backend/test/voice/usage/attribution.spec.ts`, `backend/test/voice/usage/config-snapshots.spec.ts`, `backend/test/voice/investigation.spec.ts` | Informational idle, finite retained admission guard, elapsed safety quota versus observed media/spend uncertainty. |
| `backend/src/contracts/admin-config.spec.ts`, `backend/src/platform/config/manageable-config.spec.ts`, `frontend/src/features/admin-config/config-edit-state.ts`, `frontend/src/features/admin-config/config-edit-state.test.ts` | Stored/public compatibility and accurate legacy-idle copy. Reuse existing projections; no new fields. |

### Contract/lifetime decisions consumed by later plans

| Situation | Input/output/resource behavior | Wire outcome / recovery |
| --- | --- | --- |
| Healthy foreground quiet | Stop PCM immediately on `input.suspend`; settle pending recognition once; keep STT ping and agent/TTS alive. | `voice.state.input = suspended`; no error/ended event. |
| Speech after suspension | `input.unmute` requests resume; if settling, wait internally and emit listening only when admission is safe. Same healthy STT connection/generation. | No new ready/session/conversation/turn. Browser must not upload before listening is acknowledged. |
| Manual mute | Immediately block media, fence/close recognition, discard its unfinished turn. Automatic suspension cannot undo it. | `muted`; explicit unmute opens a fresh STT connection. |
| No active Flux turn | Documented warning settles successfully, without a transcript or model call. | No `session.error`. |
| Missing settle at `min(2000, finalizationMs)` | Retire/fence old STT; never submit partial text; renew once at a safe boundary. | Still suspended until safe resume. Failed renewal pauses paid flow. |
| Provider/quota/duration/resource failure | Stop paid work; keep mounted call/control identity; no background retry loop. | Live `session.error` has `terminal: false`; recovery `resume_call` only when allowed. Duration/quota emit `session.ended` with `terminal: false`, and remain blocked. |
| Healthy old 60+30 idle window | May issue one informational warning; never call stop/end. | Warning does not promise impending hang-up. |
| Hang up / navigation / destruction | Real teardown, release admission/reservation, drain evidence. | Existing terminal ended/error events carry `terminal: true`. Shutdown is also terminal server teardown; P2 still retains its blocked mounted screen. |

`terminal` describes whether this server session/control transport has ended; it is not permission for the browser to navigate away. P2 must retain the mounted call on non-user failures even when the backend has genuinely shut down. Recovery does not promise the impossible after server/process destruction.

## Task 1: Strict wire, mirrors, and mandatory emitter flags

**Files:** Modify the two wire files; both shared fixture catalogs and their tests; `backend/src/contracts/voice.spec.ts`; `frontend/src/api/voice-protocol.test.ts`; existing `session.error`/`session.ended` emitters in `live-flow.ts`, `dictation-flow.ts`, and `voice-connection.ts`.

- [x] **Step 1: Add failing strict-wire tests.** Add `parseVoiceControl` to the existing backend wire import and append this test inside `describe('voice contracts', ...)`. The existing `envelope` is used unchanged.

```typescript
it('requires explicit terminal flags and admits suspend only in live mode', () => {
  const suspend = { ...envelope, type: 'input.suspend' };
  expect(parseVoiceControl(JSON.stringify(suspend), 'client', 'live')).toEqual(suspend);
  expect(() => parseVoiceControl(JSON.stringify(suspend), 'client', 'dictation'))
    .toThrow('INVALID_VOICE_CONTROL');
  for (const extra of [{ resume: true }, { reason: 'idle' }, { userId: 'browser' }])
    expect(() => parseVoiceControl(JSON.stringify({ ...suspend, ...extra }), 'client', 'live')).toThrow();
  const state = { ...envelope, type: 'voice.state', input: 'suspended',
    agent: 'speaking', connection: 'connected' };
  expect(isVoiceServerEvent(state, 'live')).toBe(true);
  expect(isVoiceServerEvent(state, 'dictation')).toBe(false);
  const error = { ...envelope, type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE',
    recovery: 'resume_call', recoverable: true, terminal: false };
  const ended = { ...envelope, type: 'session.ended', reason: 'quota', terminal: false };
  for (const event of [error, ended]) {
    expect(isVoiceServerEvent(event, 'live')).toBe(true);
    expect(isVoiceServerEvent({ ...event, terminal: true }, 'live')).toBe(true);
    const { terminal: flag, ...missing } = event;
    expect(flag).toBe(false);
    expect(isVoiceServerEvent(missing, 'live')).toBe(false);
    for (const terminal of [null, 0, 'false'])
      expect(isVoiceServerEvent({ ...event, terminal }, 'live')).toBe(false);
    expect(isVoiceServerEvent({ ...event, providerPayload: 'private' }, 'live')).toBe(false);
  }
  expect(isVoiceClientEvent({ ...envelope, type: 'input.resume' })).toBe(false);
});
```

In `frontend/src/api/voice-protocol.test.ts`, append the portable counterpart (uses existing `base` and parser):

```typescript
it('parses suspended input and nonterminal call failures without relaxing exact shapes', () => {
  const suspend = { ...base, type: 'input.suspend' };
  expect(parseVoiceControl(JSON.stringify(suspend), 'client', 'live')).toEqual(suspend);
  expect(() => parseVoiceControl(JSON.stringify(suspend), 'client', 'dictation')).toThrow();
  for (const event of [
    { ...base, type: 'voice.state', input: 'suspended', agent: 'speaking', connection: 'connected' },
    { ...base, type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE', recovery: 'resume_call',
      recoverable: true, terminal: false },
    { ...base, type: 'session.ended', reason: 'duration', terminal: false },
  ]) expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
  for (const type of ['session.error', 'session.ended']) {
    const event = type === 'session.error'
      ? { ...base, type, code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true }
      : { ...base, type, reason: 'error' };
    expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'live')).toThrow();
    expect(() => parseVoiceControl(JSON.stringify({ ...event, terminal: 'false' }), 'server', 'live')).toThrow();
  }
});
```

- [x] **Step 2: Run red.** From `backend/`: `npm test -- src/contracts/voice.spec.ts -t "requires explicit terminal"`. From `frontend/`: `npm test -- src/api/voice-protocol.test.ts -t "parses suspended input"`. Expected: FAIL (`INVALID_VOICE_CONTROL` / suspended guard false), not a missing dependency.

- [x] **Step 3: Apply the minimal contract changes to both portable bodies.** Keep the files identical from `export const VOICE_PROTOCOL_VERSION` onward. These are the exact changed type/shape entries:

```typescript
// Append in VOICE_ERROR_CODES:
'MEDIA_GATE_UNAVAILABLE',

export type VoiceRecovery = 'none' | 'retry_dictation' | 'resume_gesture' |
  'repeat_turn' | 'return_to_chat' | 'resume_call';

// Parameterless VoiceClientPayload variant:
| { type: 'dictation.stop' | 'dictation.cancel' | 'input.mute' | 'input.unmute' |
    'input.suspend' | 'session.end' }

// Replace these VoiceServerPayload variants; other variants stay unchanged:
| { type: 'session.ended'; reason: 'completed' | 'cancelled' | 'disconnected' |
    'duration' | 'idle' | 'quota' | 'error' | 'shutdown'; terminal: boolean }
| { type: 'voice.state'; input: 'listening' | 'suspended' | 'muted';
    agent: 'idle' | 'thinking' | 'speaking'; connection: 'connected' | 'reconnecting' }
| { type: 'session.warning'; code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean }
| { type: 'session.error'; code: VoiceErrorCode; recovery: VoiceRecovery;
    recoverable: boolean; terminal: boolean }

// Add this clientShapes entry:
'input.suspend': {},

// Replace the corresponding serverShapes entries:
'session.ended': { reason: oneOf('completed', 'cancelled', 'disconnected',
  'duration', 'idle', 'quota', 'error', 'shutdown'), terminal: bool },
'voice.state': { input: oneOf('listening', 'suspended', 'muted'),
  agent: oneOf('idle', 'thinking', 'speaking'), connection: oneOf('connected', 'reconnecting') },
'session.warning': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
  'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'), recoverable: bool },
'session.error': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
  'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'),
  recoverable: bool, terminal: bool },

// Replace the dictation-mode exclusion in parseVoiceControl:
if (mode === 'dictation' && ['input.mute', 'input.unmute', 'input.suspend',
  'response.interrupt', 'playback.progress'].includes(value.type))
  throw new Error('INVALID_VOICE_CONTROL');
```

At every existing backend `session.error` and `session.ended` construction, add `terminal: true` initially. This is mechanical compatibility, not the live pause policy; Tasks 7–8 switch only their documented live paths to false. The affected constructions are `LiveFlow.error`, `DictationFlow.complete` catch and `providerError`, `VoiceConnection` constructor's `binding.terminal`, `finish`, and `fail`. Preserve all other fields:

```diff
-this.sink.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false });
+this.sink.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false, terminal: true });
-this.sink.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true });
+this.sink.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true, terminal: true });
-if (code) this.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false });
+if (code) this.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false, terminal: true });
-this.event({ type: 'session.ended', reason });
+this.event({ type: 'session.ended', reason, terminal: true });
```

For the multiline `VoiceConnection.fail` error payload, the exact new final property is `terminal: true`. Apply both repeated dictation/error and ended occurrences, not just the first match.

- [x] **Step 4: Update the existing valid fixture catalogs, not consumer UI tests.** In both `clientControls()` arrays append `{ mode: 'live', event: { ...envelope(6), type: 'input.suspend' } }`. In both `serverControls()` arrays add `terminal: true` to their existing error/ended entries and append these entries:

```typescript
{ mode: 'live', event: { ...envelope(9), type: 'voice.state', input: 'suspended',
  agent: 'speaking', connection: 'connected' } },
{ mode: 'live', event: { ...envelope(10), type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE',
  recovery: 'resume_call', recoverable: true, terminal: false } },
{ mode: 'live', event: { ...envelope(11), type: 'session.ended', reason: 'quota', terminal: false } },
```

In each fixture catalog test replace the expected unique client type count `8` with `9`; server type count remains `12` because variants are not new event types. Add a portable-body equality assertion to the backend contract test using `readFileSync` from `node:fs`:

```typescript
it('mirrors the entire portable voice contract', () => {
  const body = (text: string) => text.slice(text.indexOf('export const VOICE_PROTOCOL_VERSION'));
  const backend = readFileSync(new URL('./voice-wire.ts', import.meta.url), 'utf8');
  const frontend = readFileSync(new URL('../../../frontend/src/api/voice-protocol.ts', import.meta.url), 'utf8');
  expect(body(frontend)).toBe(body(backend));
});
```

- [x] **Step 5: Verify green.** Backend: `npm test -- src/contracts/voice.spec.ts src/contracts/testing/voice-fixtures.spec.ts test/voice/session/dictation.spec.ts test/voice/transport/gateway.spec.ts`. Frontend: `npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts`. Expected: all discovered tests pass. Missing terminal is intentionally invalid; do not make it optional to preserve stale fixtures.

- [x] **Step 6: Commit from repository root.**

```powershell
git add backend/src/contracts/voice-wire.ts backend/src/contracts/voice.spec.ts backend/src/contracts/testing/voice-fixtures.ts backend/src/contracts/testing/voice-fixtures.spec.ts frontend/src/api/voice-protocol.ts frontend/src/api/voice-protocol.test.ts frontend/src/api/testing/voice-fixtures.ts frontend/src/api/testing/voice-fixtures.test.ts backend/src/voice/session/live-flow.ts backend/src/voice/session/dictation-flow.ts backend/src/voice/transport/voice-connection.ts
git commit -m "feat(voice): define suspend and explicit terminal contracts"
```

## Task 2: Stored configuration compatibility, without new settings

**Files:** Modify the two portable wire bodies, `backend/src/contracts/admin-config.spec.ts`, `backend/src/platform/config/manageable-config.spec.ts`, `frontend/src/features/admin-config/config-edit-state.ts`, and its existing test.

- [x] **Step 1: Add failing backend validation coverage.** Append to `backend/src/contracts/admin-config.spec.ts` (existing imports suffice):

```typescript
it('retains legacy idle fields without treating their sum as a live duration bound', () => {
  const s = defaultManageableSettings();
  s.voice.limits.liveMaxMs = 30_000;
  s.voice.limits.liveWarningMs = 20_000;
  expect(manageableSettingsSchema.safeParse(s).success).toBe(true);
  expect(manageableSettingsSchema.safeParse({ ...s, voice: { ...s.voice,
    limits: { ...s.voice.limits, idleExitAfterWarningMs: 0 } } }).success).toBe(false);
  expect(manageableSettingsSchema.safeParse({ ...s, voice: { ...s.voice,
    silenceGateMs: 5000 } }).success).toBe(false);
});
```

Append to `backend/src/platform/config/manageable-config.spec.ts`:

```typescript
it('projects unchanged legacy idle fields and the independent Flux timeout', () => {
  const settings = defaultManageableSettings();
  settings.voice.limits.liveMaxMs = 30_000;
  settings.voice.limits.liveWarningMs = 20_000;
  const snapshot = buildRuntimeSnapshot(loadBootstrapConfig({}), {
    revision: 1, settings, credentials: { openrouter: null, deepgram: null },
  }, null);
  expect(snapshot.voice.limits.idleWarningMs).toBe(60_000);
  expect(snapshot.voice.limits.idleExitAfterWarningMs).toBe(30_000);
  expect(snapshot.voice.deepgram.eotTimeoutMs).toBe(5000);
  expect(Object.keys(snapshot.settings.voice).sort())
    .toEqual(['dictationWarningMs', 'enabledModes', 'limits', 'quotas']);
});
```

Append to the existing frontend admin-state test:

```typescript
it('accepts stored legacy idle timings without advertising automatic hang-up', () => {
  const baseline = publicConfig().settings;
  const fields = { ...fieldsFromSettings(baseline),
    'voice.limits.liveMaxMs': '30000', 'voice.limits.liveWarningMs': '20000' };
  expect(settingsFromFields(baseline, fields).fieldErrors).toEqual([]);
  expect(editableFields.find(f => f.path === 'voice.limits.idleExitAfterWarningMs')?.help)
    .toBe('Stored for compatibility only. Does not end or suspend a live call.');
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- src/contracts/admin-config.spec.ts src/platform/config/manageable-config.spec.ts -t "legacy idle"`. Frontend: `npm test -- src/features/admin-config/config-edit-state.test.ts -t "legacy idle"`. Expected: FAIL because the old idle sum exceeds 30 seconds / old copy describes exit.

- [x] **Step 3: Delete only the obsolete cross-field condition and correct copy.** In both `isVoiceLimits` implementations retain every numeric/exact-shape check and replace the return expression with:

```typescript
return v.liveWarningMs < v.liveMaxMs && v.finalizationMs <= v.dictationMaxMs &&
  v.inputQueueMs <= v.dictationMaxMs && v.outputQueueMs <= v.liveMaxMs;
```

Delete this entire block in `config-edit-state.ts`:

```typescript
if (voice.limits.idleWarningMs + voice.limits.idleExitAfterWarningMs > voice.limits.liveMaxMs) {
  errors.push(...annotate([
    'voice.limits.idleWarningMs', 'voice.limits.idleExitAfterWarningMs', 'voice.limits.liveMaxMs',
  ]));
}
```

Replace the two existing field-copy entries' label/help values, not their paths/numeric bounds:

```typescript
label: 'Idle notice', help: 'Milliseconds before an informational idle notice. Does not end the call.',
label: 'Legacy idle exit delay', help: 'Stored for compatibility only. Does not end or suspend a live call.',
```

Do not edit the admin protocol shape, schema version, environment importer, or default values. They already delegate voice validation to the shared `isVoiceLimits` and project these fields unchanged. Do not add the local detector timing to stored config.

- [x] **Step 4: Verify green.** Backend: `npm test -- src/contracts/admin-config.spec.ts src/platform/config/manageable-config.spec.ts src/contracts/voice.spec.ts`. Frontend: `npm test -- src/features/admin-config/config-edit-state.test.ts src/api/voice-protocol.test.ts`. Expected: PASS including the mirror test.

- [x] **Step 5: Commit.**

```powershell
git add backend/src/contracts/voice-wire.ts frontend/src/api/voice-protocol.ts backend/src/contracts/admin-config.spec.ts backend/src/platform/config/manageable-config.spec.ts frontend/src/features/admin-config/config-edit-state.ts frontend/src/features/admin-config/config-edit-state.test.ts
git commit -m "fix(voice): retain legacy idle settings without teardown policy"
```

## Task 3: Provider-settled, idempotent Flux finalization and quiet heartbeats

**Files:** Modify `backend/src/voice/providers/flux-stt.ts`, `backend/src/contracts/voice.ts`, `backend/test/voice/providers/flux-stt.spec.ts`, and `backend/test/voice/providers/resilience.spec.ts`. Reuse `ProviderLink`; do not change its heartbeat or Nova behavior.

Primary reference already reconciled in research: [Flux/Nova comparison](https://developers.deepgram.com/docs/flux/flux-nova-3-comparison.md) says Flux Keep Alive is replaced by pings with a 60-second timeout. Existing 20-second protocol pings and 5-second pong deadline are stricter client health bounds and stay. `ForceEndTurn` yields normal manual `EndOfTurn`; `FORCE_END_TURN_NO_ACTIVE_TURN` is successful no-op settlement. `CloseStream` never finalizes a partial. A Context7 starter snippet still shows an older route; do not regress the primary-documented existing `/v2/listen` route.

- [x] **Step 1: Add failing finalization tests.** Add `vi` to the existing Vitest import in `flux-stt.spec.ts` and append:

```typescript
it('settles one ForceEndTurn only on EndOfTurn and reuses a completed turn', async () => {
  const h = harness(connected);
  const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = [], done = collect(c.events, events), s = h.sockets[0];
  await c.writeAudio(new Uint8Array(2560));
  s.json(turn('StartOfTurn', 1));
  s.json(turn('Update', 2, 'Keep the final word'));
  const a = c.finalize(), b = c.finalize();
  const resolved = vi.fn();
  void a.then(resolved);
  await tick();
  expect(resolved).not.toHaveBeenCalled();
  expect(a).toBe(b);
  expect(s.controls().filter(m => (m as { type: string }).type === 'ForceEndTurn')).toHaveLength(1);
  s.json({ ...turn('EndOfTurn', 3, 'Keep the final word.'), trigger: 'manual' });
  await Promise.all([a, b]); await tick();
  await c.finalize();
  expect(events.filter(e => e.type === 'end-of-turn')).toHaveLength(1);
  expect(events.filter(e => e.type === 'finalized')).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  expect(s.controls().filter(m => (m as { type: string }).type === 'ForceEndTurn')).toHaveLength(1);
  await c.writeAudio(new Uint8Array(2560));
  const next = c.finalize();
  s.json({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  await next; await c.close(); await done;
  expect(events.filter(e => e.type === 'error')).toEqual([]);
  expect(events.filter(e => e.type === 'end-of-turn')).toHaveLength(1);
});

it('treats no-active-turn as success and rejects outstanding finalization on close', async () => {
  const h = harness(connected);
  const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = [], done = collect(c.events, events), s = h.sockets[0];
  const idle = c.finalize();
  s.json({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  await idle; await tick();
  expect(events.filter(e => e.type === 'finalized')).toHaveLength(1);
  expect(events.some(e => e.type === 'end-of-turn' || e.type === 'error')).toBe(false);
  await c.writeAudio(new Uint8Array(2560));
  const pending = c.finalize();
  const rejected = expect(pending).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await c.close(); await rejected; await done;
});
```

The old test `ForceEndTurn is explicit; CloseStream never promotes trailing Update` currently awaits a fire-and-forget `finalize()` before supplying the acknowledgement. Replace its body with:

```typescript
const h = harness(connected);
const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
const events: SttEvent[] = [], done = collect(c.events, events);
const pending = c.finalize();
expect(h.sockets[0].controls()).toContainEqual({ type: 'ForceEndTurn' });
h.sockets[0].json({ ...turn('EndOfTurn', 1, ''), trigger: 'manual' });
await pending;
await c.close();
expect(h.sockets[0].controls()).toContainEqual({ type: 'CloseStream' });
h.sockets[0].json(turn('Update', 2, 'incomplete tail'));
await done;
expect(events.some(e => e.type === 'end-of-turn')).toBe(false);
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/providers/flux-stt.spec.ts -t "settles one ForceEndTurn|no-active-turn"`. Expected: FAIL because current finalize resolves immediately, repeats ForceEndTurn, and ignores the warning.

- [x] **Step 3: Add one pending settle to the adapter.** Immediately after the existing local provider counters, add:

```typescript
let settledInputMs = -1;
let finalization: Promise<void> | undefined;
let resolveFinalization: (() => void) | undefined;
let rejectFinalization: ((error: ProviderFault) => void) | undefined;
const settleFinalization = () => {
  settledInputMs = inputMs;
  const resolve = resolveFinalization;
  if (!resolve) return;
  resolveFinalization = undefined;
  rejectFinalization = undefined;
  link.emit({ type: 'finalized', unfinalizedTail: false });
  resolve();
};
const failFinalization = (error: ProviderFault) => {
  const reject = rejectFinalization;
  resolveFinalization = undefined;
  rejectFinalization = undefined;
  reject?.(error);
};
```

These closures refer to `link` only when invoked after its construction, matching the existing adapter pattern. After `Connected` handling, before the non-TurnInfo return, add:

```typescript
if (message.type === 'Warning' && message.code === 'FORCE_END_TURN_NO_ACTIVE_TURN') {
  settleFinalization();
  return;
}
```

Inside the existing accepted `EndOfTurn` branch, call `settleFinalization()` **after** emitting its nonempty `end-of-turn`, including the empty-transcript case. Keep sequence and `endedTurn` fencing exactly as written. Replace the two link hooks with:

```typescript
link.onFailure = error => {
  failFinalization(error);
  reportUsage(request.abortSignal.aborted ? 'cancelled' : 'failed');
};
link.onFinish = () => {
  failFinalization(new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
  reportUsage('closed');
};
```

Replace the returned `writeAudio` and `finalize` implementations:

```typescript
writeAudio: pcm => {
  if (closing || pcm.byteLength !== 2560)
    return Promise.reject(new ProviderFault('INVALID_AUDIO_FRAME', 'repeat_turn', false));
  if (resolveFinalization)
    return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'resume_call'));
  return link.send(pcm, this.cfg.limits.inputQueueMs * 32).then(() => {
    inputMs += 80;
    finalization = undefined;
  });
},
finalize: () => {
  if (finalization) return finalization;
  if (!link.active || closing)
    return Promise.reject(new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
  if (settledInputMs === inputMs) return Promise.resolve();
  finalization = new Promise<void>((resolve, reject) => {
    resolveFinalization = resolve;
    rejectFinalization = reject;
  });
  void link.json({ type: 'ForceEndTurn' }).catch(error => {
    failFinalization(error instanceof ProviderFault ? error : new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
  });
  return finalization;
},
```

Do not add an adapter timer that competes with the flow timer. Task 5 owns the existing finalization deadline and calls close to reject/drain this pending promise. Do not call `link.finish()` when finalization settles; the live socket remains usable. In `voice.ts`, document the existing interface method/event semantics (Nova closes, Flux stays open):

```typescript
/** Resolves after provider settlement, not merely after writing the finalization command. */
finalize(): Promise<void>;
```

- [x] **Step 4: Add the quiet-heartbeat regression in `resilience.spec.ts`.** It uses that file's existing fake-timer cleanup and provider harness:

```typescript
it('holds quiet Flux STT with protocol pings and no KeepAlive or replacement PCM', async () => {
  vi.useFakeTimers();
  const h = harness(connected);
  const opening = new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  await vi.advanceTimersByTimeAsync(0);
  const c = await opening;
  try {
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].pings).toBe(9);
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.sockets[0].terminated).toBe(false);
  } finally { await c.close(); }
});
```

This is a deterministic protocol test, not provider certification for indefinite ping-only `/v2/listen`. No silent frames are invented. Existing dead-pong and Nova JSON KeepAlive tests must still pass.

- [x] **Step 5: Verify green.** Backend: `npm test -- test/voice/providers/flux-stt.spec.ts test/voice/providers/resilience.spec.ts test/voice/providers/nova-stt.spec.ts`. Expected: PASS with no unhandled finalization rejection.

- [x] **Step 6: Commit.**

```powershell
git add backend/src/contracts/voice.ts backend/src/voice/providers/flux-stt.ts backend/test/voice/providers/flux-stt.spec.ts backend/test/voice/providers/resilience.spec.ts
git commit -m "fix(voice): settle Flux finalization once without closing input"
```

## Task 4: Input-only suspension and manual-mute privacy

**Files:** Modify `backend/src/voice/session/live-flow.ts` and `backend/test/voice/session/live.spec.ts`. Reuse that test's existing `fixture()`, `ref`, `usage`, and fake ports. No output/provider/bridge API changes.

Tests that deliberately keep a retired fake reader open must still clean it up on assertion failure. Add `const retiredInputQueues: Array<{ end(): void }> = []` beside the existing `services`/`flows` arrays, and run this as the first line in the existing async `afterEach`, before closing flows:

```typescript
for (const queue of retiredInputQueues.splice(0)) queue.end();
```

- [x] **Step 1: Add the failing suspend/settlement test.** Append to `live.spec.ts`:

```typescript
it('suspends PCM and settles once without cancelling speech or agent work', async () => {
  const f = await fixture();
  let resolveFinal!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementation(() =>
    new Promise<void>(resolve => { resolveFinal = resolve; }));
  await f.flow.speak({ ...ref, text: 'Keep speaking.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.connection.close).not.toHaveBeenCalled();
  expect(f.tts.connection.close).not.toHaveBeenCalled();
  expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.hooks.disconnected).not.toHaveBeenCalled();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'voice.state', input: 'suspended',
    agent: 'speaking', connection: 'connected' });
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'pending', text: 'Do not drop this.' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'pending', text: 'Do not drop this.' });
  resolveFinal(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.sink.finish).not.toHaveBeenCalled();
});

it('manual mute supersedes suspension and fences the unfinished old turn', async () => {
  const f = await fixture(), fresh = fakeStt();
  let resolveFinal!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementation(() =>
    new Promise<void>(resolve => { resolveFinal = resolve; }));
  // Keep the retired fake readable so this test can actually exercise stale callbacks.
  vi.mocked(f.stt.connection.close).mockResolvedValue(undefined);
  retiredInputQueues.push(f.stt.events);
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.mute' }));
  await expect(f.flow.control(f.control({ type: 'input.suspend' })))
    .rejects.toMatchObject({ code: 'VOICE_INVALID_STATE' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'retired', text: 'Never submit this.' });
  resolveFinal(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  f.stt.events.end();
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/session/live.spec.ts -t "suspends PCM|manual mute supersedes"`. Expected: FAIL `VOICE_INVALID_STATE` on the new suspend event.

- [x] **Step 3: Add only the input state/settlement path.** Add these fields beside `muted`:

```typescript
private suspended = false;
private resumeRequested = false;
private settlingInput?: Promise<void>;
```

Replace the admitted write in `input()` and the input projection in `state()`:

```typescript
if (!this.muted && !this.suspended) await this.stt.writeAudio(pcm);

input: this.muted ? 'muted' : this.suspended ? 'suspended' : 'listening',
```

Add these methods to `LiveFlow` (Task 5 subsequently bounds and extends their failure path):

```typescript
private suspendInput() {
  if (this.muted) fault('VOICE_INVALID_STATE');
  if (this.suspended) return;
  this.suspended = true;
  this.resumeRequested = false;
  this.state();
  const generation = this.sttGeneration;
  const pending = this.stt.finalize().catch(error => {
    if (!this.closed && generation === this.sttGeneration)
      this.error(voiceError(error, 'STT_UNAVAILABLE').code);
  }).finally(() => {
    if (this.settlingInput === pending) this.settlingInput = undefined;
    if (!this.closed && generation === this.sttGeneration) this.resumeInput();
  });
  this.settlingInput = pending;
}

private resumeInput() {
  if (this.closed || this.muted || this.settlingInput || !this.suspended || !this.resumeRequested) return;
  this.suspended = false;
  this.resumeRequested = false;
  this.state();
}
```

At the start of `control()` after its closed check, add the new event and suspended unmute branches. They deliberately do not await provider settlement on the transport's receive chain:

```typescript
if (e.type === 'input.suspend') { this.suspendInput(); return; }
if (e.type === 'input.unmute' && this.suspended && !this.muted) {
  this.resumeRequested = true;
  this.resumeInput();
  return;
}
```

In the existing `input.mute` branch, immediately after `this.muted = true`, add:

```typescript
this.suspended = false;
this.resumeRequested = false;
```

In `readStt`, change **only** the `StartOfTurn` interruption branch guard to `e.type === 'start-of-turn' && !this.muted && !this.suspended`. Leave nonempty `EndOfTurn` handling enabled while suspended: it is the pending turn's real final result, not a request to cancel output. Keep the existing `turns` dedupe, pending-turn ceiling, and lifetime signal. No detector or transport event authorizes interruption.

- [x] **Step 4: Verify green and privacy.** Backend: `npm test -- test/voice/session/live.spec.ts -t "suspends PCM|manual mute supersedes|mute discards|only submits|StartOfTurn"`. Expected: PASS. Suspension does not call `hooks.disconnected`, abort `thinking`, reset TTS, or emit `response.cancelled`. The existing manual-mute test still requires a fresh STT connection.

- [x] **Step 5: Commit.**

```powershell
git add backend/src/voice/session/live-flow.ts backend/test/voice/session/live.spec.ts
git commit -m "feat(voice): suspend uploads without cancelling live output"
```

## Task 5: Bounded settle, fenced STT renewal, and late-open privacy

**Files:** Modify `backend/src/voice/session/live-flow.ts`, `backend/src/voice/session/voice-session.options.ts`, and `backend/test/voice/session/live.spec.ts`. No new provider/flow abstraction. This task makes suspension failure-safe before downstream browser work consumes it.

- [x] **Step 1: Add failing timeout and safe-boundary tests.** Append to `live.spec.ts` and add `vi.useRealTimers()` at the end of its existing `afterEach` cleanup:

```typescript
it('renews STT after 2000ms without promoting a partial or starting inference', async () => {
  vi.useFakeTimers();
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(() => {}));
  vi.mocked(f.stt.connection.close).mockResolvedValue(undefined);
  retiredInputQueues.push(f.stt.events);
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  f.stt.events.push({ type: 'partial', segmentId: 'lost', text: 'An incomplete identifier' });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'late', text: 'Never replay.' });
  await settle();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.tts.connection.close).not.toHaveBeenCalled();
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.context.response.conversationId).toBeNull();
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
  f.stt.events.end();
});

it('defers quiet STT renewal until current speech drains and renews only once without media', async () => {
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.port.connect).mockResolvedValueOnce(fresh.connection);
  await f.flow.speak({ ...ref, text: 'Finish this response.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await settle();
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await settle();
  f.stt.events.end(); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
  await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.tts.port.connect).toHaveBeenCalledTimes(1);
  fresh.events.end(); await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(2);
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error', code: 'STT_UNAVAILABLE' }));
});

it('closes a late unmute connection if mute wins the opening race', async () => {
  const f = await fixture(), fresh = fakeStt();
  let connected!: () => void;
  vi.mocked(f.stt.port.connect).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { connected = resolve; });
    return fresh.connection;
  });
  await f.flow.control(f.control({ type: 'input.mute' }));
  const opening = f.flow.control(f.control({ type: 'input.unmute' }));
  await settle();
  await f.flow.control(f.control({ type: 'input.mute' }));
  connected(); await opening; await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.close).toHaveBeenCalledTimes(1);
  expect(fresh.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.sink.event).not.toHaveBeenLastCalledWith(expect.objectContaining({ input: 'listening' }));
});

it('clears the suspension deadline immediately on hang-up', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  vi.mocked(f.stt.connection.finalize).mockImplementation(() => new Promise<void>(() => {}));
  await f.flow.control(f.control({ type: 'input.suspend' }));
  await f.flow.close(); await settle();
  expect(vi.getTimerCount()).toBe(0);
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
});

it('does not reopen or admit PCM when the original admission forbids paid work', async () => {
  const f = await fixture();
  await f.flow.control(f.control({ type: 'input.suspend' })); await settle();
  const { VoiceSessionError } = await import('../../../src/voice/session/voice-session.options.js');
  f.context.assertPaidWork = () => { throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED', 'none'); };
  await f.flow.control(f.control({ type: 'input.unmute' }));
  await settle();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ code: 'VOICE_QUOTA_EXHAUSTED' }));
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/session/live.spec.ts -t "renews STT|defers quiet STT|late unmute|suspension deadline|original admission forbids"`. Expected: FAIL (no timed replacement, old flow errors on held-socket loss, late unmute undoes mute, uncleared deadline, or missing admission guard).

- [x] **Step 3: Add the optional admission guard and minimal renewal state.** Add to `SessionContext` in `voice-session.options.ts`:

```typescript
/** Checks the original admission; transport renewal must not mint a new lease. */
assertPaidWork?(): void;
```

Task 7 attaches this callback to the existing binding. Existing literal test contexts remain valid. In `LiveFlow` add:

```typescript
private inputLost = false;
private renewalUsed = false;
private retiredStt?: Promise<void>;
private cancelInputSettlement?: () => void;
```

- [x] **Step 4: Bound pending suspension and cancel its timer on teardown.** Replace the minimal `suspendInput()`/`resumeInput()` from Task 4 with the following methods. This is the only input-finalization timer; it is cleaned up on success, failure, mute and hang-up through the provider's settlement/close path:

```typescript
private suspendInput() {
  if (this.muted) fault('VOICE_INVALID_STATE');
  if (this.suspended) return;
  this.suspended = true;
  this.resumeRequested = false;
  this.state();
  const generation = this.sttGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const finalization = this.stt.finalize();
  const pending = Promise.race([finalization, new Promise<void>((_resolve, reject) => {
    cancel = () => reject(new VoiceSessionError('STT_UNAVAILABLE', 'resume_call'));
    this.cancelInputSettlement = cancel;
    timer = setTimeout(cancel, Math.min(2000, this.context.response.limits.finalizationMs));
  })]).catch(() => {
    if (!this.closed && !this.muted && generation === this.sttGeneration) this.retireInput();
  }).finally(() => {
    clearTimeout(timer);
    if (this.cancelInputSettlement === cancel) this.cancelInputSettlement = undefined;
    if (this.settlingInput === pending) this.settlingInput = undefined;
    this.resumeInput();
  });
  this.settlingInput = pending;
}

private retireInput() {
  if (this.closed || this.muted || this.inputLost) return;
  this.inputLost = true;
  this.sttGeneration++;
  this.retiredStt = this.stt.close().catch(() => undefined);
  this.resumeInput();
}

private resumeInput() {
  if (this.closed || this.muted || this.settlingInput) return;
  if (this.inputLost) { void this.renewInput(); return; }
  if (!this.suspended || !this.resumeRequested) return;
  try { this.context.assertPaidWork?.(); }
  catch (error) { this.error(voiceError(error, 'VOICE_QUOTA_EXHAUSTED').code); return; }
  this.suspended = false;
  this.resumeRequested = false;
  this.state();
}
```

- [x] **Step 5: Add the one-shot safe-boundary input renewer.** These methods stay in `LiveFlow`, next to the input state methods:

```typescript
private async renewInput() {
  if (this.closed || this.muted || !this.inputLost || this.settlingInput || this.openingStt ||
    this.pendingTurns || this.current || this.resettingTts || this.agent !== 'idle') return;
  // ponytail: one renewal per quiet stretch without new admitted media; another failure pauses for manual recovery, not a retry loop.
  if (this.renewalUsed) { this.error('STT_UNAVAILABLE'); return; }
  this.renewalUsed = true;
  const generation = this.sttGeneration;
  const opening = (async () => {
    await this.retiredStt;
    if (this.closed || this.muted || generation !== this.sttGeneration)
      throw new VoiceSessionError('VOICE_SESSION_ENDED', 'none');
    this.context.assertPaidWork?.();
    return this.deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: this.signal });
  })();
  this.openingStt = opening;
  try {
    const stt = await opening;
    try {
      if (this.closed || this.muted || generation !== this.sttGeneration) { await stt.close(); return; }
      this.context.assertPaidWork?.();
    } catch (error) { await stt.close(); throw error; }
    this.stt = stt;
    this.inputLost = false;
    this.startInputReader();
  } catch (error) {
    if (!this.closed && !this.muted && generation === this.sttGeneration)
      this.error(voiceError(error, 'STT_UNAVAILABLE').code);
  } finally {
    if (this.openingStt === opening) this.openingStt = undefined;
  }
  if (!this.inputLost) this.resumeInput();
}

private unavailableInput(generation: number, code: import('../../contracts/voice-wire.js').VoiceErrorCode) {
  if (this.closed || generation !== this.sttGeneration) return;
  if (this.suspended && (code === 'STT_UNAVAILABLE' || code === 'VOICE_CONNECT_TIMEOUT')) this.retireInput();
  else this.error(code);
}
```

The newly connected socket stays local until its post-open guard succeeds, so a budget stop during connection cannot leak it.

- [x] **Step 6: Wire retirement and safe-boundary wakeups.** Replace the STT error branch and the consumer-end/catch paths in `readStt`:

```typescript
} else if (e.type === 'error') {
  this.unavailableInput(generation, e.fault.code);
}
```

```typescript
this.unavailableInput(generation, 'STT_UNAVAILABLE');
```

```typescript
} catch (error) {
  this.unavailableInput(generation, error instanceof VoiceSessionError ? error.code : 'STT_UNAVAILABLE');
}
```

Append `this.resumeInput()` to `state()` **after** sending its event. Existing `completePlayback` and final-chain cleanup call `state()` at their safe boundaries, so no extra timer, agent hook, or queue is needed. In `input()`, replace Task 4's write with:

```typescript
if (!this.muted && !this.suspended && !this.inputLost) {
  this.context.assertPaidWork?.();
  await this.stt.writeAudio(pcm);
  this.renewalUsed = false;
}
```

Do not clear `turns`, `responses`, context IDs, wire cursors or reservation during renewal. Retired-generation usage remains accounted before the existing generation guard; its transcript/start-of-turn callbacks remain fenced.

- [x] **Step 7: Fence ordinary manual-unmute opens too.** Change the mute no-op guard to `if (this.muted && !this.openingStt) return;`, so a new mute invalidates an in-flight open. In its branch clear `this.inputLost = false` together with suspended/resume intent. Replace the existing manual-unmute branch with:

```typescript
if (e.type === 'input.unmute') {
  if (!this.muted || this.openingStt) return;
  this.context.assertPaidWork?.();
  const generation = this.sttGeneration;
  const opening = this.deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: this.signal });
  this.openingStt = opening;
  try {
    const stt = await opening;
    try {
      if (this.closed || generation !== this.sttGeneration) { await stt.close(); return; }
      this.context.assertPaidWork?.();
    } catch (error) { await stt.close(); throw error; }
    this.stt = stt;
    this.muted = false;
    this.renewalUsed = false;
    this.startInputReader();
    this.state();
  } finally {
    if (this.openingStt === opening) this.openingStt = undefined;
  }
  return;
}
```

Keep the earlier suspended-unmute branch before this one. In the mute branch, invoke `this.cancelInputSettlement?.()` after incrementing `sttGeneration`. In `close()`, increment `sttGeneration` and invoke `this.cancelInputSettlement?.()` immediately after setting `closed = true`; do not replace the existing tracked-reader/opening cleanup. Add `await this.retiredStt` alongside the existing reset/open drain. A close must not await its own reader from within `readStt`; error routing stays non-blocking as in the existing source.

- [x] **Step 8: Verify green, including the admission regression written in Step 1.** Backend: `npm test -- test/voice/session/live.spec.ts test/voice/providers/flux-stt.spec.ts`. Expected: PASS; no extra inference/Flush, no orphan open and no stale callback submission. Paid-flow policy stops in Task 8 close this flow before more output; do not edit P3's delivery classes.

- [x] **Step 9: Commit.**

```powershell
git add backend/src/voice/session/live-flow.ts backend/src/voice/session/voice-session.options.ts backend/test/voice/session/live.spec.ts
git commit -m "fix(voice): bound and fence suspended STT renewal"
```

## Task 6: Informational idle, finite original budgets, and honest estimates

**Files:** Modify `backend/src/voice/usage/voice-usage.service.ts`, `backend/test/voice/usage/quota.spec.ts`, `backend/test/voice/usage/attribution.spec.ts`, `backend/test/voice/usage/config-snapshots.spec.ts`, and the direct flow/usage regression `backend/test/voice/investigation.spec.ts`. Keep existing rates/limits/quotas and the process-local storage model.

- [x] **Step 1: Replace the idle-stop expectation with a failing no-stop test.** Replace `warns after 60 idle seconds and stops 30 seconds later unless activity resumes` in `quota.spec.ts`:

```typescript
it('keeps the live admission after the old 60 plus 30 second idle exit', async () => {
  const { service, config, time, warns, stops } = harness();
  const live = context(config, 'live');
  const lease = await service.admission(live);
  time.advance(60_000);
  expect(warns).toEqual([{ sessionId: live.response.sessionId, code: 'VOICE_IDLE_TIMEOUT' }]);
  time.advance(120_000);
  expect(stops).toEqual([]);
  expect(service.snapshot().active).toBe(1);
  service.noteActivity(live.response.sessionId, true);
  time.advance(120_000);
  expect(stops).toEqual([]);
  expect(warns).toHaveLength(1);
  await lease.release();
});
```

Append this test (the existing `rates` fixture is used):

```typescript
it('keeps an exhausted original lease blocked without a fresh admission or clock reset', async () => {
  const h = harness({ VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1', ...rates });
  const live = context(h.config, 'live');
  const lease = await h.service.admission(live);
  h.time.advance(59_999);
  expect(() => lease.assertActive()).not.toThrow();
  await h.service.disconnected(live);
  h.time.advance(1);
  expect(h.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
  expect(() => lease.assertActive()).toThrowError('VOICE_QUOTA_EXHAUSTED');
  h.time.advance(12 * 60 * 60 * 1000);
  expect(() => lease.assertActive()).toThrowError('VOICE_QUOTA_EXHAUSTED');
  expect(h.service.snapshot().sessions).toBe(1);
  await lease.release();
});
```

- [x] **Step 2: Add the failing in-flight estimate/media distinction.** Append inside the existing `voice usage attribution` suite:

```typescript
it('does not price an open quiet call as final usage or elapsed time as uploaded media', async () => {
  const h = harness({ DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
    DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' });
  const live = context(h.config, 'live');
  const lease = await h.service.admission(live);
  await h.service.usage(live, { usageId: 'media-1', providerRequestId: 'request-1',
    model: 'flux-general-en', modelVersion: null, audioMs: 80, billableCharacters: null });
  h.time.advance(180_000);
  expect(h.service.snapshot()).toMatchObject({ sttAudioMs: 80,
    estimatedSpendUsd: null, spendStatus: 'unknown', active: 1 });
  await lease.release();
  expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(80 / 60_000 * 0.01, 8);
  expect(h.service.snapshot().spendStatus).toBe('known');
  // A fresh service proves the deliberately process-local, non-restart-durable ceiling.
  expect(harness().service.snapshot().sessions).toBe(0);
});

it('retains unknown usage after a provider failure even when its admission is released', async () => {
  const h = harness({ DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
    DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' });
  const live = context(h.config);
  const lease = await h.service.admission(live);
  h.service.observe(live, { stage: 'flow-error', code: 'STT_UNAVAILABLE' });
  await lease.release();
  expect(h.service.snapshot()).toMatchObject({ estimatedSpendUsd: null, spendStatus: 'unknown',
    audioComplete: false, charactersComplete: false });
});
```

Add this failing lower-bound regression to `quota.spec.ts`, using its existing `rates` constant:

```typescript
it('stops at the known spend lower bound even when a different observation is unknown', async () => {
  const h = harness({ VOICE_DAILY_SPEND_USD: '0.01', ...rates });
  const live = context(h.config);
  await h.service.admission(live);
  await h.service.usage(live, { usageId: 'unknown-stt', providerRequestId: null,
    model: 'flux-general-en', modelVersion: null, audioMs: null, billableCharacters: null });
  await h.service.usage(live, { usageId: 'known-tts', providerRequestId: 'tts-1',
    model: 'flux-haley-en', modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
  expect(h.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
  expect(h.service.snapshot()).toMatchObject({ spendStatus: 'unknown', estimatedSpendUsd: null });
});
```

- [x] **Step 3: Run red.** Backend: `npm test -- test/voice/usage/quota.spec.ts test/voice/usage/attribution.spec.ts -t "old 60|original lease|open quiet|known spend lower bound|unknown usage after a provider failure"`. Expected: FAIL on old idle stop, missing `assertActive`, falsely final known estimate, cap suppression by unknown evidence, or invented zero cost after failure.

- [x] **Step 4: Delete idle teardown, expose the retained lease guard, and freeze stopped elapsed time.** Delete only the nested scheduling line in `armIdle`:

```diff
-lease.idleCancels.push(this.ports.schedule(limits.idleExitAfterWarningMs, () => this.halt(lease.sessionId, 'idle')));
```

Add `stopReason?: VoiceStopReason` to the existing `Lease` type. Change `admission`'s explicit return signature and final return:

```typescript
async admission(context: SessionContext): Promise<{ release: () => Promise<void>; assertActive: () => void }> {
```

```typescript
return { release: () => this.release(row.sessionId), assertActive: () => this.assertActive(row.sessionId) };
```

Add this private guard; it uses the captured lease limits/quotas and the existing aggregate budget calculation, never `admission()`:

```typescript
private assertActive(sessionId: string) {
  const lease = this.active.get(sessionId);
  if (!lease) throw new VoiceSessionError('VOICE_SESSION_ENDED', 'none');
  if (lease.halting) throw new VoiceSessionError(
    lease.stopReason === 'duration' ? 'VOICE_DURATION_LIMIT' :
    lease.stopReason === 'shutdown' ? 'VOICE_DISABLED' : 'VOICE_QUOTA_EXHAUSTED', 'none');
  const cap = lease.mode === 'live' ? lease.limits.liveMaxMs : lease.limits.dictationMaxMs;
  if (this.elapsed(lease) >= cap) throw new VoiceSessionError('VOICE_DURATION_LIMIT', 'none');
  this.assertBudget(lease.userId, 0, lease.quotas);
}
```

In `halt`, immediately after `lease.halting = true`, add:

```typescript
lease.stopReason = reason;
lease.endedAt = this.ports.now();
```

In `release` replace `lease.endedAt = this.ports.now()` with `lease.endedAt ??= this.ports.now()`. This records the safety clock stop, not fictitious additional paid time while a blocked call screen waits for Hang up. Duration/daily-minute limits remain conservative **elapsed admitted work** limits, not provider invoice audio minutes. Do not rename the existing fields or claim they are measured audio. Resume never restarts these clocks.

In `snapshot()`, immediately before returning, add:

```typescript
// Open/paused admissions may still receive provider evidence. Known means a closed observed estimate, never an invoice guarantee.
spendKnown &&= this.active.size === 0;
```

Keep observed STT/TTS media counters unchanged; no socket-open-time conversion. In `usage()` and `assertBudget()`, replace the spend-cap guards with the following respective lines:

```typescript
if (cap !== null && spend.usd >= cap)
  this.halt(context.response.sessionId, 'quota');

if (quotas.dailySpendUsd !== null && spend.usd >= quotas.dailySpendUsd) {
  this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
}
```

`dailySpend().usd` is the accumulated nonnegative known **lower bound**, even when another row is unknown. Known observed spend at the cap must stop work; missing evidence cannot suppress that stop. Unknown rates still cannot invent a cost, and all minute/duration/concurrency caps remain finite. No LLM price is silently included in these speech estimates.

In `observe()`, immediately after its existing stage allowlist check, mark failure observations as incomplete. The existing hook works even for a failed initial allocation with no running flow reader:

```typescript
if (event.stage === 'flow-error' || event.stage === 'transport-error') {
  const row = this.find(context.response.sessionId);
  if (row) { row.audioComplete = false; row.charactersComplete = false; }
}
```

In `cost()`, prepend `row.audioComplete &&` to the existing `known` initializer, retaining its rate checks and later character-completeness check:

```typescript
let known = row.audioComplete && rates.novaPerMinuteUsd !== null && rates.fluxSttPerMinuteUsd !== null
  && rates.fluxTtsPerThousandCharsUsd !== null;
```

A failed/unknown provider allocation cannot become a known-zero final estimate merely because Hang up releases its lease. Keep numerical observed lower bounds for enforcement; do not erase them when confidence becomes unknown.

- [x] **Step 5: Reconcile direct regression expectations, preserving the actual assertions.** In `attribution.spec.ts` test `replaces cumulative STT snapshots and adds distinct TTS speeches once`, capture `const lease = await service.admission(live)` and insert `await lease.release()` immediately before `const snap = service.snapshot()`. Existing exact observed totals and closed estimate checks remain.

In `usage/config-snapshots.spec.ts`:

1. Rename `live activity after publication rearms original idle warning/exit` to `live activity after publication retains its original informational idle warning`; replace its final `expect(h.stops.map(s => s.reason)).toEqual(['idle'])` with `expect(h.stops).toEqual([])`.
2. In `uses revision 2 duration and rates for new work`, capture `const lease = await h.service.admission(c)`. Before the duration timer fires, require `expect(h.service.snapshot().spendStatus).toBe('unknown')`; after its existing duration assertion, call `await lease.release()` and retain `expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(0.03, 8)` there rather than before release.
3. In `known old costs are not repriced after publication`, capture the admission lease and `await lease.release()` after the usage event but before its first cost assertion. Both old-price assertions remain unchanged.

In `backend/test/voice/investigation.spec.ts`, rename `still times out silence-only PCM while a generating reply is not idle` to `keeps quiet and generating calls open beyond the old idle grace`. Replace both of that test's positive idle-stop expectations with the negative form below; preserve its fixture cleanup, agent hold/release and other assertions. This is a direct policy regression, not P4's runtime integration suite:

```typescript
expect(silent.h.stops).not.toContainEqual({ sessionId: 'voice-session-1', reason: 'idle' });
expect(busy.h.stops).not.toContainEqual({ sessionId: 'voice-session-1', reason: 'idle' });
```

- [x] **Step 6: Verify green.** Backend: `npm test -- test/voice/usage test/voice/investigation.spec.ts`. Expected: all direct usage suites pass, including preserved duration, daily minute, concurrent admission, rate, revision capture, drain, redaction, late accounting, and rollover checks. There is no idle stop and no lease renewal on reconnect.

- [x] **Step 7: Commit.**

```powershell
git add backend/src/voice/usage/voice-usage.service.ts backend/test/voice/usage/quota.spec.ts backend/test/voice/usage/attribution.spec.ts backend/test/voice/usage/config-snapshots.spec.ts backend/test/voice/investigation.spec.ts
git commit -m "fix(voice): keep idle calls open under original resource budgets"
```

## Task 7: Retained session policy stops and original-admission guards

**Files:** Modify `backend/src/voice/session/voice-session.options.ts`, `backend/src/voice/session/voice-session.service.ts`, and `backend/test/voice/session/controller.spec.ts`. No `app.service.ts` edit: its existing admission callback returns the richer lease structurally, and its existing stop callback reaches this service.

- [x] **Step 1: Add failing session-policy tests.** Append inside `voice REST admission`:

```typescript
it.each(['duration', 'quota'] as const)('retains the same admitted call after a %s stop', async reason => {
  const { s, o } = fixture();
  const created = await s.create({ ...request, mode: 'live' }, origin);
  const binding = s.claim(created.cookie.split(';')[0], origin);
  binding.pause = vi.fn(async () => undefined);
  binding.cleanup = vi.fn(async () => undefined);
  binding.terminal = vi.fn();
  await s.stop(created.response.sessionId, reason);
  await s.stop(created.response.sessionId, reason);
  expect(binding.pause).toHaveBeenCalledTimes(1);
  expect(binding.pause).toHaveBeenCalledWith(reason);
  expect(binding.terminal).not.toHaveBeenCalled();
  expect(binding.cleanup).not.toHaveBeenCalled();
  expect(s.snapshot().active).toBe(1);
  expect(() => binding.assertPaidWork?.()).toThrowError(
    reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : 'VOICE_DURATION_LIMIT');
  const duplicate = await s.create({ ...request, mode: 'live' }, origin);
  expect(duplicate.response.sessionId).toBe(created.response.sessionId);
  expect(duplicate.cookie).toBe('');
  expect(o.admission).toHaveBeenCalledTimes(1);
  expect(o.reservations.acquire).toHaveBeenCalledTimes(1);
  expect(o.reservations.release).not.toHaveBeenCalled();
  await s.end(created.response.sessionId);
  expect(o.reservations.release).toHaveBeenCalledTimes(1);
});

it('does not turn the legacy idle stop into a live terminal event', async () => {
  const { s } = fixture();
  const created = await s.create({ ...request, mode: 'live' }, origin);
  const binding = s.claim(created.cookie.split(';')[0], origin);
  binding.terminal = vi.fn(); binding.pause = vi.fn(async () => undefined);
  await s.stop(created.response.sessionId, 'idle');
  expect(binding.terminal).not.toHaveBeenCalled();
  expect(binding.pause).not.toHaveBeenCalled();
  expect(s.snapshot().active).toBe(1);
});

it('checks original duration and admission on resume without re-admitting', async () => {
  vi.useFakeTimers();
  const { s, o } = fixture();
  const assertActive = vi.fn();
  o.admission = vi.fn(async () => ({ release: vi.fn(async () => undefined), assertActive }));
  const created = await s.create({ ...request, mode: 'live' }, origin);
  const binding = s.claim(created.cookie.split(';')[0], origin);
  binding.assertPaidWork?.();
  expect(assertActive).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(binding.response.limits.liveMaxMs);
  expect(() => binding.assertPaidWork?.()).toThrowError('VOICE_DURATION_LIMIT');
  expect(o.admission).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/session/controller.spec.ts -t "retains the same|legacy idle stop|original duration"`. Expected: FAIL (old stop tears down the binding or no guard is attached).

- [x] **Step 3: Extend existing callback shapes without requiring unrelated mocks to change.** In `VoiceSessionOptions.admission` and `VoiceBinding.admission`, use the same inline lease shape:

```typescript
{ release(): Promise<void>; assertActive?(): void }
```

Add these fields to `VoiceBinding` (import `VoiceErrorCode` in its existing wire import):

```typescript
startedAt: number;
blockedCode?: VoiceErrorCode;
pause?: (reason: 'duration' | 'quota') => Promise<void>;
```

In `createOnce`, immediately before awaiting `this.options.admission(context)`, capture `const startedAt = Date.now()`. Include `startedAt` in the existing entry literal. Immediately after that literal, before registration/claim, attach:

```typescript
entry.assertPaidWork = () => this.assertPaidWork(entry);
```

Add this service method. It is intentionally not a second admission or an execution reservation:

```typescript
private assertPaidWork(entry: VoiceBinding) {
  if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
  if (entry.identity.userId !== this.options.identity.resolve().userId) fault('VOICE_BINDING_MISMATCH');
  if (entry.blockedCode) fault(entry.blockedCode);
  const cap = entry.response.mode === 'live' ? entry.response.limits.liveMaxMs : entry.response.limits.dictationMaxMs;
  if (Date.now() - entry.startedAt >= cap) {
    entry.blockedCode = 'VOICE_DURATION_LIMIT';
    fault(entry.blockedCode);
  }
  entry.admission.assertActive?.();
}
```

Replace `stop()` with:

```typescript
async stop(id: string, reason: 'duration' | 'idle' | 'quota' | 'shutdown') {
  const entry = this.entries.get(id);
  if (!entry || entry.state === 'ended') return;
  if (entry.response.mode === 'live' && reason !== 'shutdown') {
    if (reason === 'idle' || entry.blockedCode) return;
    entry.blockedCode = reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED';
    await entry.pause?.(reason);
    return;
  }
  try { entry.terminal?.(reason); } finally { await this.end(id); }
}
```

Before consuming a claim, after the existing state/deadline validations and before clearing its token, add `entry.assertPaidWork?.()`. This prevents opening providers with an already-expired ticket/admission. Do not change `createOnce`'s active duplicate response behavior: it cannot mint a new socket ticket. The production lease guard catches shared daily/spend ceilings; the registry independently catches original duration and explicit hard stops.

**Actual disconnect/destruction is different from quiet:** keep `disconnected()`'s existing bounded cleanup/reconnect deadline and `end()` after deadline. It must release abandoned resources; it cannot deliver a wire event after losing the wire. P2 keeps its mounted blocked surface on exhausted reconnect and may not create a different session to bypass that exhaustion. Healthy suspend and connected resource pauses never enter this path. Shutdown remains a real terminal server drain, not a fictionally connected call.

- [x] **Step 4: Verify green.** Backend: `npm test -- test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts test/voice/usage`. Expected: PASS; hard block is sticky for that admission even after a later config revision/day rollover, reservation release still occurs once on Hang up, and duplicate POST does not re-admit.

- [x] **Step 5: Commit.**

```powershell
git add backend/src/voice/session/voice-session.options.ts backend/src/voice/session/voice-session.service.ts backend/test/voice/session/controller.spec.ts
git commit -m "feat(voice): retain blocked calls without renewing admission"
```

## Task 8: Nonterminal paid-flow pause and same-control-connection recovery

**Files:** Modify `backend/src/voice/session/voice-session.options.ts`, `backend/src/voice/session/live-flow.ts`, `backend/src/voice/transport/voice-connection.ts`, `backend/test/voice/transport/gateway.spec.ts`, and `backend/test/voice/session/live.spec.ts`.

This task owns the small unavoidable transport caller change. Do not change `frontend/src/api/voice-client.ts` or browser controller behavior here; P2 must consume `terminal`, honor suspended admission, and retain its surface even after a real terminal shutdown/disconnect. Do not claim those browser behaviors passed in this worker.

- [x] **Step 1: Add failing direct transport tests.** Import `VoiceSessionError` and `voiceError` from `../../../src/voice/session/voice-session.options.js` in `gateway.spec.ts`, then append:

```typescript
it.each(['duration', 'quota'] as const)('stops paid work for %s without closing the call control socket', async reason => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  await f.s.stop(f.result.response.sessionId, reason); await settle();
  const code = reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED';
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code, terminal: false, recoverable: false, recovery: 'none' }));
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended', reason, terminal: false }));
  expect(flow.close).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  expect(f.s.snapshot().active).toBe(1);
  f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(flow.input).not.toHaveBeenCalled();
  expect(f.o.open).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  f.socket.text({ ...f.event('session.start', 2), type: 'session.end', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.socket.close).toHaveBeenCalled();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended', reason: 'completed', terminal: true }));
});

it('reopens a failed paid flow on unmute using the same binding and no second ready event', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const [binding, sink] = vi.mocked(f.o.open).mock.calls[0];
  const first = await vi.mocked(f.o.open).mock.results[0].value;
  sink.pause?.('STT_UNAVAILABLE'); await settle();
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code: 'STT_UNAVAILABLE', terminal: false, recovery: 'resume_call', recoverable: true }));
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.o.open).toHaveBeenCalledTimes(2);
  expect(vi.mocked(f.o.open).mock.calls[1][0]).toBe(binding);
  expect(f.o.admission).toHaveBeenCalledTimes(1);
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
  expect(f.socket.events().some(e => e.type === 'conversation.bound')).toBe(false);
  expect(f.socket.close).not.toHaveBeenCalled();
});

it('keeps a failed live provider handshake paused and emits ready only after permitted recovery', async () => {
  const f = await fixture('live');
  vi.mocked(f.o.open).mockRejectedValueOnce(new VoiceSessionError('STT_UNAVAILABLE', 'resume_call'));
  f.socket.text(f.event('session.start')); await settle();
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(0);
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error', terminal: false }));
  expect(f.socket.close).not.toHaveBeenCalled();
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
  expect(f.o.admission).toHaveBeenCalledTimes(1);
  expect(f.socket.close).not.toHaveBeenCalled();
});

it('preserves allowlisted parser fault messages but never returns private error text', () => {
  for (const code of ['INVALID_VOICE_CONTROL', 'INVALID_AUDIO_FRAME'] as const)
    expect(voiceError(new Error(code), 'VOICE_DELIVERY_UNKNOWN').code).toBe(code);
  expect(voiceError(new Error('private provider payload'), 'VOICE_DELIVERY_UNKNOWN').code)
    .toBe('VOICE_DELIVERY_UNKNOWN');
});

it('does not reopen paid work when pausing could not drain its old flow', async () => {
  const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  vi.mocked(flow.close).mockRejectedValueOnce(new Error('private persistence failure'));
  const sink = vi.mocked(f.o.open).mock.calls[0][1];
  sink.pause?.('TTS_UNAVAILABLE'); await settle();
  f.socket.text({ ...f.event('session.start', 1), type: 'input.unmute', mode: undefined, audioSettings: undefined });
  await settle();
  expect(f.o.open).toHaveBeenCalledTimes(1);
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code: 'VOICE_DELIVERY_UNKNOWN', recoverable: false, terminal: false }));
  expect(JSON.stringify(f.socket.events())).not.toContain('private persistence failure');
});
```

The old `sends intentional %s before cleanup instead of provoking reconnect` test must not assert idle/duration/quota as teardown anymore. Replace its parameterized body with the shutdown-only version:

```typescript
it('sends terminal shutdown before the real server drain', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  await f.s.stop(f.result.response.sessionId, 'shutdown');
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.ended',
    reason: 'shutdown', terminal: true }));
  expect(f.socket.close).toHaveBeenCalled();
});
```

- [x] **Step 2: Run red.** Backend: `npm test -- test/voice/transport/gateway.spec.ts -t "stops paid work|reopens a failed|failed live provider handshake|allowlisted parser|could not drain"`. Expected: FAIL (no pause callback, socket closed, wrong normalized code, or no drain block). The required terminal flags must not be weakened to make tests green.

- [x] **Step 3: Extend the existing sink callback and route live failures to it.** Add to `VoiceSink`:

```typescript
/** Stops paid resources, retaining the admitted call/control connection. */
pause?(code: VoiceErrorCode, recoverable?: boolean): void;
```

In `LiveFlow.error()`, replace the old terminal error/finish/close tail with:

```typescript
const recoverable = !['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
  'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT'].includes(code);
if (this.sink.pause) this.sink.pause(code, recoverable);
else this.sink.event({ type: 'session.error', code,
  recovery: recoverable ? 'resume_call' : 'none', recoverable, terminal: false });
void this.close().catch(() => undefined);
```

Keep its existing observation call. Do not call `sink.finish` on a live provider/agent/resource pause. `close()` aborts/drains this **paid flow and bridge**, not the session or its control transport. Suspension never calls it. Reopening after a failure uses `options.open` to construct a fresh bridge under the existing binding, rather than attempting to reuse `AgentVoiceAdapter.disconnected()`'s permanently closed instance.

- [x] **Step 4: Add paid-flow pause/reopen methods to the existing transport.** Import `VoiceErrorCode` and `voiceError` using existing imports. Add fields:

```typescript
private paused = false;
private pauseCode?: VoiceErrorCode;
private pausing?: Promise<void>;
private pauseDrainFailed = false;
```

In the constructor, retain `binding.cleanup`, `binding.warning` and terminal shutdown handling, and add:

```typescript
binding.pause = async reason => {
  this.pause(reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED', false);
  this.event({ type: 'session.ended', reason, terminal: false });
  await this.pausing;
};
```

Add these methods:

```typescript
pause(code: VoiceErrorCode, recoverable = !['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
  'VOICE_DISABLED', 'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT'].includes(code)) {
  if (this.closed) return;
  const wasPaused = this.paused;
  this.paused = true;
  clearTimeout(this.timer);
  if (!wasPaused || this.pauseCode !== code)
    this.sessions.options.observe?.(this.binding, { stage: 'flow-error', code });
  try {
    if (!wasPaused || this.pauseCode !== code) this.event({ type: 'session.error', code,
      recovery: recoverable ? 'resume_call' : 'none', recoverable, terminal: false });
  } catch { /* A lost control socket must not prevent stopping paid work. */ }
  this.pauseCode = code;
  if (wasPaused) return;
  this.pausing = (async () => {
    const retiring = this.flow ?? await this.starting?.catch(() => undefined);
    await retiring?.close();
    if (this.flow === retiring) this.flow = undefined;
  })().catch(() => {
    // Evidence may be uncertain; keep paid work stopped, never pretend the old delivery completed.
    this.pauseDrainFailed = true;
    try { this.event({ type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN',
      recovery: 'none', recoverable: false, terminal: false }); }
    catch { /* The transport may already have gone away. */ }
  });
}
```

- [x] **Step 5: Add one guarded paid-flow reopen operation.** It reuses the old control binding and does not call `create()` or `admission()`:

```typescript
private async resumePaidWork() {
  await this.pausing;
  if (this.closed || !this.paused) return;
  if (this.pauseDrainFailed) {
    this.event({ type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN',
      recovery: 'none', recoverable: false, terminal: false });
    return;
  }
  try {
    this.binding.assertPaidWork?.();
    const firstReady = !this.ready;
    this.starting = this.sessions.options.open(this.binding, this, this.abort.signal);
    const flow = await this.starting;
    try {
      if (this.closed) { await flow.close(); return; }
      this.binding.assertPaidWork?.();
    } catch (error) { await flow.close(); throw error; }
    this.flow = flow;
    this.paused = false;
    this.pauseCode = undefined;
    this.ready = true;
    if (firstReady) this.event({ type: 'session.ready', limits: this.binding.response.limits,
      effectiveAudioSettings: this.binding.response.effectiveAudioSettings });
    flow.start();
    this.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  } catch (error) {
    this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
  }
}
```

The separate `pauseDrainFailed` flag blocks a failed reconciliation/drain before any new provider allocation. The original failure code `VOICE_DELIVERY_UNKNOWN` alone does not imply that drain failed. Do not clear this flag on Resume; only real teardown releases this blocked flow.

- [x] **Step 6: Gate paused binary/control admission without resetting wire sequences.** Keep all origin, epoch, exact-control-shape, sequence, duplicate, byte, and queue checks. The binary-ready guard becomes:

```typescript
if ((!this.ready && !this.paused) || this.inputEnded) fault('VOICE_INVALID_STATE');
```

At the existing call to `flow.input`, include `!this.paused` in its condition. Decode and advance valid sequence/sample cursors even for discarded paused frames, so a stale sender cannot cause a replay on resume. A paused residual frame cannot finalize anything. Add `if (this.paused) return;` at the beginning of `audio()` so a retiring provider cannot leak paid output.

After control identity/epoch/sequence admission, **before** the existing `!this.ready` branch, handle:

```typescript
if (e.type === 'session.end') { this.finish('completed'); return; }
if (this.paused) {
  if (e.type === 'input.unmute') await this.resumePaidWork();
  return;
}
```

Remove the later duplicate `session.end` check. Paused `input.mute`/`input.suspend` never reopen anything, and old playback progress is discarded with the retired flow. `input.unmute` is the only permitted reopen intent; its guard reuses the old lease. Sequence/event ID/input/output cursors are never zeroed during same-socket recovery.

- [x] **Step 7: Keep initial provider failure on the same control binding.** In the initial session-start allocation, replace the existing open/await section with:

```typescript
try {
  this.binding.assertPaidWork?.();
  this.starting = this.sessions.options.open(this.binding, this, this.abort.signal);
  const flow = await this.starting;
  try {
    if (this.closed || this.paused) { await flow.close(); return; }
    this.binding.assertPaidWork?.();
  } catch (error) { await flow.close(); throw error; }
  this.flow = flow;
} catch (error) {
  if (this.binding.response.mode !== 'live') throw error;
  this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
  return;
}
```

After this block preserve the existing ready flag, connect-timer cleanup, `session.ready` payload and start ordering, using `this.flow!.start()`. The post-open guard closes its newly opened local flow before rethrowing, so elapsed quota during connection cannot leak it.

- [x] **Step 8: Normalize and route faults without weakening protocol validation.** Before changing receive fault routing, make the shared `voiceError()` normalizer preserve **allowlisted** parser `Error.message` codes. In `voice-session.options.ts`, replace its `const code` initializer with the following; retain the existing `VOICE_ERROR_CODES.includes` check and fallback return. This single shared correction covers parser/codec callers without leaking arbitrary messages:

```typescript
const code = candidate && typeof candidate === 'object' && 'code' in candidate ? candidate.code
  : error instanceof Error ? error.message : null;
```

Replace the receive-chain `.catch` with sanitized fault routing:

```typescript
}).catch(error => {
  const code = voiceError(error, 'VOICE_DELIVERY_UNKNOWN').code;
  const pauseCodes: readonly string[] = ['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
    'VOICE_DISABLED', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_PROVIDER_RATE_LIMITED',
    'VOICE_AGENT_FAILED', 'VOICE_DELIVERY_UNKNOWN', 'VOICE_CONNECT_TIMEOUT', 'AUDIO_BUFFER_OVERFLOW'];
  if (this.binding.response.mode === 'live' && pauseCodes.includes(code)) this.pause(code);
  else this.fail(code);
})
```

Retain the existing `.finally` counter cleanup. In `fail(code)`, before `this.failing = true`, route pre-chain live resource faults consistently:

```typescript
if (this.binding.response.mode === 'live' && ['AUDIO_BUFFER_OVERFLOW', 'VOICE_CONNECT_TIMEOUT'].includes(code)) {
  this.pause(code as VoiceErrorCode);
  return;
}
```

Malformed control, binding/epoch/sequence and framing violations remain actual terminal protocol failures with `terminal: true`; do not permit a new provider on an untrusted/broken protocol. P2 still does not automatically navigate away on them. Keep dictation's original terminal semantics.

- [x] **Step 9: Drain a pending pause on real teardown.** In `dispose()`, await `this.pausing` in the existing provider-drain `try` before final socket close. Real Hang up/DELETE/unmount cleanup must drain both a retiring and a late-opening flow exactly once, even if a pause is in progress. The exact additional statement is:

```typescript
await this.pausing;
```

- [x] **Step 10: Verify nonterminal live errors and the unsafe-drain regression from Step 1.** In `live.spec.ts`, strengthen `TTS failure during speech cancels through VoiceConnection without INVALID_VOICE_CONTROL` after its event-validity loop:

```typescript
expect(events).toContainEqual(expect.objectContaining({ type: 'session.error',
  code: 'TTS_UNAVAILABLE', terminal: false, recovery: 'resume_call' }));
expect(socket.close).not.toHaveBeenCalled();
```

Backend: `npm test -- test/voice/transport/gateway.spec.ts test/voice/session/live.spec.ts test/voice/session/dictation.spec.ts test/voice/session/controller.spec.ts test/voice/usage`. Expected: PASS, including terminal shutdown, lost-socket cleanup, epoch replay rejection, manual mute, accepted-turn dedupe, late evidence, and all new pause cases.

- [x] **Step 11: Commit.**

```powershell
git add backend/src/voice/session/voice-session.options.ts backend/src/voice/session/live-flow.ts backend/src/voice/transport/voice-connection.ts backend/test/voice/transport/gateway.spec.ts backend/test/voice/session/live.spec.ts
git commit -m "feat(voice): pause paid flows without hanging up admitted calls"
```

## Task 9: Offline verification and downstream handoff

**Files:** Tick this plan as implemented. Do not edit `state.md`, P2/P3/P4 plans, final verification/report, package manifests, or cross-layer integration files in this task. Send the orchestrator the actual commit set and command outcomes; it owns the workflow records. This verification task intentionally has no new production code or invented failing test.

- [x] **Step 1: Check offline prerequisites, named-path ownership and wire parity.** Before any broad routine/e2e test (routine voice integration discovery also contains native-guarded suites), do not print environment values and run:

```powershell
if ($env:AURVIN_TEST_MONGODB_URI) { throw 'Native service access is not authorized by this offline plan; report broad-suite execution as blocked and request explicit scope.' }
```

Do not silently unset an operator's environment to manufacture skips. The focused mock-only checks can still run while broad service-bearing discovery waits for authorization. From repository root:

```powershell
git diff --check
git status --short
git log -9 --oneline
```

Expected: no whitespace errors; only P1-owned source/test paths and plan progress belong to this worker's changes. Preserve foreign/untracked configuration. From `backend/`, run:

```powershell
npm test -- src/contracts/voice.spec.ts src/contracts/testing/voice-fixtures.spec.ts src/contracts/admin-config.spec.ts src/platform/config/manageable-config.spec.ts test/voice/providers/flux-stt.spec.ts test/voice/providers/resilience.spec.ts test/voice/session test/voice/transport/gateway.spec.ts test/voice/usage test/voice/investigation.spec.ts
```

From `frontend/`, run:

```powershell
npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts src/features/admin-config/config-edit-state.test.ts
```

Expected: all discovered P1 tests pass, with no new skips or unhandled rejections. A green command with zero discovered tests is not evidence. Do not disable assertions or loosen `terminal` validation to get green.

- [x] **Step 2: Run both package checks separately.** From `backend/`, run each command separately:

```powershell
npm run build
```

```powershell
npm run lint
```

```powershell
npm test
```

From `frontend/`, run each separately:

```powershell
npm run build
```

```powershell
npm run lint
```

```powershell
npm test
```

Record exit codes and actual test/pass/skip counts. Backend and frontend build/lint should pass. Record any out-of-scope compatibility failure explicitly and return its exact file/test to the orchestrator; do not edit another owner's implementation to hide it. One known downstream raw fixture is `frontend/src/features/voice/integration-tests/pipeline.test.ts`, test `learns a lost first binding on same-session reconnect and never retries an intentional shutdown`: its handwritten shutdown frame currently lacks required `terminal`, and its exit expectations predate P2's retained call. P4 owns that integration expectation. P1 must report it if it fails; it is not permission to claim the full frontend suite passed or to make the wire flag optional. P2's existing browser transport/controller still needs its planned nonterminal handling after this commit.

- [x] **Step 3: Run native-gated discovery only without a database connection.** Do not print environment values. From `backend/`:

```powershell
if ($env:AURVIN_TEST_MONGODB_URI) { throw 'Native service access is not authorized by this offline plan; report this gate as blocked and request explicit scope.' }
```

If that prerequisite check passes, run:

```powershell
npm run test:e2e
```

Expected: deterministic e2e cases execute; MongoDB-dependent cases skip through their existing native guard. Record the actual counts, not a blanket pass. If a separately authorized isolated native run is later approved, require operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never source the application database, remove the guard, or print the URI. `test:azure`/`test:behavior` can succeed with empty discovery and are not required evidence for this offline P1 change.

- [x] **Step 4: Prove the P1 exit matrix against actual tests.** The worker's handoff must name passing tests for every row; do not turn planned coverage into claimed results:

| P1 exit | Required direct evidence |
| --- | --- |
| Strict wire/config | Task 1 exact-shape/mode/terminal tests, portable parity and fixture catalogs; Task 2 stored/public config and admin validation tests. |
| No media on suspended/paused input | Task 4 admitted-write count; Task 8 paused transport binary discard; Task 3 180-second ping-only socket test. P2 owns the actual five-second detector timing. |
| Pending turn settles once | Task 3 identical pending promise, one ForceEndTurn and warning success; Task 4 one finalized-hook call despite duplicate provider EOT. |
| Manual-mute privacy | Original fresh-STT mute regression plus Task 4 supersession and Task 5 late-open fencing. No buffered replay or silent substitute frames. |
| Stale callbacks / safe renewal | Task 5 timeout, old EOT rejection, safe speech drain, one renewal per quiet stretch; Task 8 drain-failure block. |
| No inference on resume/renew | No finalized-hook call on timeout renewal, no conversation-bound event or new admission/reservation on flow reopen; original accepted-turn tests remain green. Full runtime proof remains P4. |
| Finite/honest resource policy | Task 6 original duration/daily quota/spend lower-bound and unknown in-flight tests; Task 7 sticky original-admission guard; Task 8 blocked Resume and terminal explicit Hang up. |
| Compatibility and limitation honesty | Dictation and provider regression suites; package results listed separately; native skips explicit; no device/provider/acoustic/invoice evidence claimed. |

If a row fails, repair the owning P1 code/test with its smallest runnable regression and rerun affected checks. Do not dispatch a reviewer or run paid/live checks. If a required repair reaches another owner's path, report the exact boundary and wait for the orchestrator rather than implementing it here.

- [x] **Step 5: Commit plan progress only after source/test commits and actual verification.** Stage this plan by name:

```powershell
git add docs/voice-cost-and-flow/plan1.md
git commit -m "docs(voice-cost-and-flow): record P1 implementation progress"
```

The worker reports: implemented commit hashes, all command outcomes, out-of-scope failing checks (if any), skipped/native/live limits, and the consumed contracts below. A known downstream failure is an explicit handoff/gate, never a passed check.

### Worker handoff (contracts, not downstream implementation tasks)

- P2 receives `input.suspend`, suspended input state, `resume_call`, `MEDIA_GATE_UNAVAILABLE`, and mandatory terminal flags. `input.unmute` requests admission again; wait for server listening before PCM/pre-roll. Suspended-unmute is not manual-mute discard/restart. Ordinary suspension preserves ongoing agent/TTS; failure pause may cancel/drain paid work. Only real teardown sends terminal completion. Neither terminal nor recoverable is an automatic browser-navigation command.
- P2 retains the existing call/draft on idle, policy stop, provider/config/device failure, and exhausted reconnect. Quota/duration/reconnect exhaustion cannot be bypassed by creating a new session. Its transport/controller owns gesture gating and must not reinterpret an idle notice as impending Hang up. P1's direct tests do not certify this UI.
- P3 receives unchanged speech/output hooks and one-Flush behavior. It must not edit `live-flow.ts`. Input-only suspension cannot be used to invalidate its output or reset evidence.
- P4 receives the existing richer admission handle through unchanged central callbacks, same binding identity on recovery, exact source/test commits, known downstream fixture compatibility, and all verification limitations. No central wiring edit is required merely to propagate the guard: `VoiceSessionService` attaches it to the binding already passed to `openVoice`. Full browser/runtime assembly remains its verification responsibility.
- Usage is process-local, restart-nondurable and speech-cost-estimated; elapsed quota safety time, observed PCM/STT media, TTS characters, LLM usage, and unknown invoice charges remain distinct. Ping-only provider longevity, acoustic detection/quality, and actual billing savings remain unverified until separately authorized device/service evaluation.

## Planner self-check

- Requirements mapped: strict contract/mode/terminal validation (1–2), one settled finalization/no-active-turn (3), no PCM/no cancellation/mute privacy (4), finite timeout/renewal/stale callbacks (5), no idle exit and honest finite quotas (6), no admission reset (7), nonterminal paid-work pause and guarded same-binding recovery (8), actual offline evidence and limitations (9).
- No source implementation is performed by writing this artifact. No P2/P3/P4 files are assigned for implementation. Mandatory emitter/transport caller ripple is explicitly confined to the P1 boundary.
- No paid provider, microphone, application database, external deployment, new dependency, new user setting, resume event, parser, output optimization, or additional Flush is authorized.
- Review remains **skipped**. Runtime/acoustic/billing readiness is not inferred from this plan or from passing fixtures.
