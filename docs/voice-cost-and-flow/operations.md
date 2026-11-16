# Voice Cost and Flow Operations

## Authority and topology

This feature is authorized for offline verification only. No paid provider request,
real microphone, application-database access, provisioning or deployment is authorized.
Use the existing single-process executor and server-only credentials. Text readiness
and diagnostic liveness are not speech health or an acoustic certification.

## Input and call lifetime

The foreground call remains mounted during quiet, transport recovery and policy stops.
After 5,000 ms confirmed non-speech (one 80 ms frame tolerance), stop PCM upload; never
send replacement silent PCM. Up to 320 ms local pre-roll is bounded, transient and
released once only after the same session acknowledges listening. Local speech/noise
does not directly execute an agent turn or interrupt output; Flux turn events remain
authoritative. Quiet input suspension does not stop Aurvin's ongoing output.

Mute discards pending media and disables capture; auto-resume cannot undo it. Hidden
or frozen pages stop capture and clear transient audio while keeping the call screen.
Returning may require Resume voice. Permission loss and detector/WASM failure pause
visibly; there is no unlimited-streaming fallback. Hang up and Alt+X release resources;
pagehide, unmount and navigation also clean up. Escape interrupts, not hangs up.

## Safety and recovery

Recoverable provider pauses may Resume on the same session after listening ACK.
Duration/quota/configuration stops and exhausted reconnects leave the call blocked;
Resume cannot reset ceilings or allocate a replacement session to bypass policy.
Non-terminal error/end events preserve the control socket, not permission to upload.
True terminal wire events close transport but do not navigate out of the mounted call.
Do not automatically replay inference, accepted input or old response audio.

## Output and diagnostics

Safe prose release starts at 24 characters on whitespace with existing hidden-content
filters. Generated evidence remains durable before Speak; dirty evidence is bounded
at 100 ms or 512 characters and drained on finish/cancel/settle. There is one synthesis
response and one final Flush, not a Flush per sentence. Playback adds one 100 ms origin
reserve per response, not per packet/sentence. Late invalidated audio is discarded.

Distinguish model-first-output, safe-text release, evidence-write delay, Speak dispatch,
provider first audio, transport receipt and playback scheduling. Browser observations
report startupReserveMs, underruns and underrunMs. Existing server pipeline logs are
redacted stage/correlation data, not raw audio/text/keys. No new payload logging or raw
audio persistence is permitted. Fixtures identify application starvation/queue behavior;
they do not establish the acoustic cause of audible gaps in provider recordings.

## Accounting

Report observed STT upload ms/bytes separately from elapsed call duration, provider
socket duration, TTS characters/audio and LLM attempts/tokens. Unknown/in-flight usage
and provider charges stay unknown. An estimated spend is not an invoice. Process-local
quota counters are not restart-durable; cancellation cannot guarantee zero charges.

## Change and rollback

Keep model/voice/rates identical for comparisons. There is no new feature toggle or
storage migration. A deployment or rollback requires separate operator authorization,
a drained executor and the established persistence handoff procedure; never run old
and new executors together. Do not roll back only one wire-contract participant.
Consult the Phase 1 operations procedure and feature verification record before
claiming readiness.

- [Phase 1 operations](../aurvin-phase-1/operations.md)
- [Acceptance goal](goal.md)
- [Verification](verification.md)
- [Listening evaluation and consent gate](evaluation.md)
