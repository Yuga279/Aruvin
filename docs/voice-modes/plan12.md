# Flux TTS Connected Validation Defect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed local silent-startup rejection of a valid resolved TTS model name within the already-approved live-startup acceptance scope.

**Architecture:** Validate `Connected.model_name` with the existing bounded nonempty `providerId` schema instead of treating it as a query-name echo. Preserve configured voice selection, request URL, request/version validation, and requested-model accounting. Reuse in-memory sockets and actual adapters/session transport for offline regressions; change no session or transport production source.

**Tech Stack:** Existing TypeScript NodeNext, Zod, Vitest fake timers, and in-memory Deepgram/socket fixtures; no new dependencies.

---

## Evidence, ownership, and gates

- Confirmed evidence: [live-delivery-investigation.md](live-delivery-investigation.md), commit `eff53e4`, latest finding dated 13 October 2026. Configured `flux-haley-en` received HTTP101/Connected with a differing resolved-name string; strict equality caused `TTS_UNAVAILABLE`, then startup `VOICE_DELIVERY_UNKNOWN`.
- The actual resolved-name value was not disclosed. Use a **synthetic** differing value below, never claim it is the observed provider name.
- This is a defect correction, not a new feature/spec. Review remains **SKIPPED**, not passed; do not dispatch a reviewer.
- P3 owns provider source/tests. The session regression below needs the actual `session.ready` boundary, so its test-only addition is P5-owned/coordinated. A sole worker may execute both only with explicit P5 test ownership handoff; otherwise serialize the P3 change and P5 regression. No production P5 edits.
- No more provider calls are authorized. No database access, application startup, `.env` loading, device/live checks, diagnostic remapping, delivery settlement/offset/precision fixes, model fallback, retries, new dependencies, or schema/config changes.
- Preserve the existing configured-model allowlist and `/v2/speak` model query. `providerId` is already `z.string().min(1).max(128)`; do not add trimming, an echo comparison, or a new naming allowlist. Keep requested-model accounting, not the resolved-name value.
- All commits are serialized by the orchestrator. Stage named owner paths only; obtain the sole-writer slot before staging/committing.

## File map

| Action | Exact file | Responsibility / owner |
| --- | --- | --- |
| Modify | `backend/src/voice/providers/flux-tts.ts:86–89` | Connected resolved-name guard only; P3 |
| Modify | `backend/test/voice/providers/flux-tts.spec.ts` | Different-name success, guard negatives, bounds and existing URL/accounting behavior; P3 |
| Modify (test only) | `backend/test/voice/session/live.spec.ts` | Actual adapters → LiveFlow → VoiceConnection ready/idle regression; P5 |
| Reuse unchanged | `backend/test/fixtures/deepgram/socket.ts` | `harness`, `connected`, `config`, `output`, `collect`, `tick` |
| Reuse unchanged | `backend/test/voice/session/fixtures.ts`, `backend/test/voice/transport/fixtures.ts` | Admission options and transport FakeSocket |

Existing code headers remain intact; no new code files are needed. Do not edit historical investigation results or workflow completion records to imply this fix was already tested.

### Task 1: Reproduce different-name rejection and lock down guards

**Files:** `backend/test/voice/providers/flux-tts.spec.ts` (P3).

- [ ] **Step 1: Add the exact failing success regression** after the current configured-voice streaming test. Its configured name remains the default `flux-haley-en`; retain that existing test's checks for all three allowlisted voices, full URL parameters, and requested-model usage.

```typescript
it('accepts a bounded resolved model name different from the requested Flux voice', async () => {
  const h = harness({ ...connected, model_name: 'fixture-resolved-haley-v2' });
  const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  try {
    expect(h.requests[0].url.searchParams.get('model')).toBe('flux-haley-en');
    expect(h.sockets[0].readyState).toBe(1);
    expect(h.sockets[0].terminated).toBe(false);
  } finally {
    await c.close();
  }
});
```

- [ ] **Step 2: Run the single regression from `backend` before editing source.**

```powershell
npm test -- test/voice/providers/flux-tts.spec.ts -t "accepts a bounded resolved model name different from the requested Flux voice"
```

Expected: **FAIL** with `TTS_UNAVAILABLE` at connect, caused by the old equality guard. Record the actual failure; unrelated setup failures are not a valid red result.

- [ ] **Step 3: Add exact negative/boundary cases**, using local packet copies so the shared fixture is unchanged. These require the same `TTS_UNAVAILABLE` rejection, not raw parser errors or diagnostic changes.

```typescript
it.each(['model_name', 'request_id', 'model_version'] as const)(
  'rejects missing, empty, non-string and overlong Connected %s', async field => {
    for (const value of [undefined, '', 42, 'x'.repeat(129)]) {
      const packet: Record<string, unknown> = { ...connected };
      if (value === undefined) delete packet[field];
      else packet[field] = value;
      const h = harness(packet);
      await expect(new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output()))
        .rejects.toMatchObject({ fault: { code: 'TTS_UNAVAILABLE' } });
      expect(h.sockets[0].terminated).toBe(true);
    }
  });

it.each(['x', 'x'.repeat(128)])('accepts bounded resolved model name %s', async name => {
  const h = harness({ ...connected, model_name: name });
  const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await c.close();
});
```

Run the provider file: negatives pass before the fix; different-name/boundary positives fail. The loop exercises four cases for each of three fields, regardless of Vitest's displayed test count.

### Task 2: Add the actual ready boundary and six-second no-utterance regression

**Files:** `backend/test/voice/session/live.spec.ts` (P5 test-only handoff required).

- [ ] **Step 1: Add these imports**, preserving existing `settle` import and using a distinct transport socket name.

```typescript
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import { VoiceConnection } from '../../../src/voice/transport/voice-connection.js';
import { INPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import { harness, connected } from '../../fixtures/deepgram/socket.js';
import { FakeSocket as TransportSocket } from '../transport/fixtures.js';
```

- [ ] **Step 2: Add the offline startup regression**. `options()` enables live mode and mocks accounting/admission/storage. STT uses its documented minimal Connected shape, TTS a valid synthetic resolved name. No utterance, audio frame, agent runtime, or reply is produced.

```typescript
it('reaches session.ready with a resolved TTS name and stays open for six silent seconds', async () => {
  vi.useFakeTimers();
  const o = options();
  const stt = harness({ type: 'Connected', request_id: 'fixture-stt', sequence_id: 0 });
  const tts = harness({ ...connected, model_name: 'fixture-resolved-haley-v2' });
  const hooks: LiveHooks = {
    finalized: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined),
    playback: vi.fn(async () => undefined),
    disconnected: vi.fn(async () => undefined)
  };
  o.open = vi.fn((context, sink, signal) => LiveFlow.open(context, sink, signal, {
    stt: new FluxSttAdapter(o.config, stt.factory, stt.accounting),
    tts: new FluxTtsAdapter(o.config, tts.factory, tts.accounting),
    hooks, usage: o.usage
  }));
  const service = new VoiceSessionService(o);
  const socket = new TransportSocket();
  let connection: VoiceConnection | undefined;
  try {
    const result = await service.create({ ...request, mode: 'live' }, origin);
    const binding = service.claim(result.cookie.split(';')[0], origin);
    connection = new VoiceConnection(service, binding, socket);
    connection.receive(Buffer.from(JSON.stringify({
      protocolVersion: 1, sessionId: result.response.sessionId,
      connectionEpoch: result.response.connectionEpoch, eventId: 'start-1', sequence: 0,
      type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO
    })), false);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    await settle();
    expect(socket.events().filter(e => e.type === 'session.ready')).toHaveLength(1);
    expect(socket.events().some(e => e.type === 'session.error' || e.type === 'session.ended')).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    for (const h of [stt, tts]) {
      expect(h.sockets).toHaveLength(1);
      expect(h.sockets[0].readyState).toBe(1);
      expect(h.sockets[0].terminated).toBe(false);
      expect(h.sockets[0].sent).toEqual([]);
    }
    expect(hooks.finalized).not.toHaveBeenCalled();
    expect(hooks.delivery).not.toHaveBeenCalled();
  } finally {
    await connection?.dispose();
    await service.drain();
    await Promise.all([stt.accounting.drain(), tts.accounting.drain()]);
    vi.useRealTimers();
  }
});
```

- [ ] **Step 3: Run before the source correction**, from `backend`:

```powershell
npm test -- test/voice/session/live.spec.ts -t "reaches session.ready with a resolved TTS name and stays open for six silent seconds"
```

Expected: **FAIL**, zero ready events because TTS validation rejects. This test observes six seconds of no-input fixture time, not browser/device silence, provider uptime, or production persistence admission. Never substitute fake speech ports for the actual adapters in this regression.

### Task 3: Minimal correction, verification, and serialized commit

**Files:** `backend/src/voice/providers/flux-tts.ts:86–89` (P3), plus tests above.

- [ ] **Step 1: Replace only the Connected strict equality line**. Leave the preceding request/version parsing and all URL/config/accounting/other message behavior untouched:

```typescript
        if (message.type === 'Connected') {
          requestId = providerId.parse(message.request_id); version = providerId.parse(message.model_version);
          providerId.parse(message.model_name); return;
        }
```

- [ ] **Step 2: Run focused offline suites from `backend`.**

```powershell
npm test -- test/voice/providers/flux-stt.spec.ts test/voice/providers/flux-tts.spec.ts test/voice/providers/accounting.spec.ts test/voice/session/live.spec.ts test/voice/transport/gateway.spec.ts
npm run build
npm run lint
```

Expected: every discovered focused test passes, including all new regressions; build/lint exit zero. Record actual test/file counts and any skips/failures separately. Commands are separate invocations, not live/provider/database checks. Correct only owned regressions; report unrelated failures to the orchestrator without broadening the diff.

- [ ] **Step 3: Inspect the exact diff and obtain the sole-writer commit slot.** Confirm production diff is only the equality-to-`providerId.parse` replacement, configured voice/query and requested-model usage tests still pass, and no secrets/generated/unrelated files are staged.

```powershell
git diff --check
git diff -- backend/src/voice/providers/flux-tts.ts backend/test/voice/providers/flux-tts.spec.ts backend/test/voice/session/live.spec.ts
git add backend/src/voice/providers/flux-tts.ts backend/test/voice/providers/flux-tts.spec.ts backend/test/voice/session/live.spec.ts
git commit -m "fix(voice): validate resolved Flux TTS model name"
```

The three-path commit assumes the explicit P5 test handoff described above; without it P3 stages only the two provider paths, and P5 commits its test separately after the P3 correction. Return commit hash(es), actual red/green evidence, modified paths, and limitations. Do not claim full voice delivery fixed, live retest passed, or review performed.

## Completion evidence required

- [ ] Exact differing-name provider and actual-session regression failed against the old guard.
- [ ] Missing/empty/non-string/129-character names and request/version negatives reject; 1/128-character names accept.
- [ ] Configured-model URL/allowlist behavior and requested-model accounting preserved; focused provider/session suites, build, and lint results reported.
- [ ] Offline actual-adapter `session.ready` observed once and still open after 6000ms with no utterance or reply.
- [ ] Serialized commit(s) reported; review **SKIPPED**; further provider/DB/app/device tests **not run / not authorized**.
