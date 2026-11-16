# Voice Modes Staging Evidence

Policy: [operations](operations.md). Acceptance: [verification](verification.md).
Status: unrun. No real-device results recorded.
Environment: loopback or separately authorized access-controlled staging only.
No public deployment, feature enablement, provisioning, or provider call is authorized here.

## Browser and device matrix

Record actual browser/OS/device/version, input/output device, sample rate,
secure context, gesture, provider/model versions and tested commit for every row.
Node audio fakes/SSR are not browser/device evidence; desktop emulation is not iOS/Android evidence.

| Browser | Permission/Worklet/playback | Keyboard/reduced motion/privacy | Mute/interrupt/lifecycle | Status |
| --- | --- | --- | --- | --- |
| Chrome | no measurement | no measurement | no measurement | unrun |
| Edge | no measurement | no measurement | no measurement | unrun |
| Firefox | no measurement | no measurement | no measurement | unrun |
| Safari | no measurement | no measurement | no measurement | unrun |
| iOS Safari | no measurement | no measurement | no measurement | unrun |
| Android Chrome | no measurement | no measurement | no measurement | unrun |

## Exact per-row procedure

1. Open the actual approved build on HTTPS or loopback. Record commit and device.
   Before activation confirm no microphone prompt/indicator or capture/provider socket.
2. Activate Dictate message by keyboard. Deny permission; text input/Send still work.
   Clear site permission, activate again and grant; verify the real AudioWorklet
   loads, recording label, hardware sample rate and actual 16 kHz PCM resampling.
3. Draft "Before OLD after", select OLD backward, dictate two revised phrases.
   Verify prefix/suffix, no duplicate finals, no auto-Send after a pause, read-only
   recording, Stop/Enter gating, final editable text and Cancel selection restore.
4. Preserve an unsent draft and enter live mode by explicit gesture. Inspect actual
   DOM, accessibility tree/live regions, wire JSON and sidebar/history after exit:
   no user/assistant live transcript, token animation, unsent draft or private reasoning.
   Hear streamed audio and prove listening remains active while speaking.
5. Tab/Shift+Tab, Enter/Space activate labeled native controls; visible focus remains.
   Alt+M mute, Escape stop, Alt+X exit; IME/repeat/text-input shortcuts must not trigger.
   Enable OS reduced motion: inspect computed animation and labels, not source CSS alone.
6. Mute while speaking: capture transmission/buffers stop, playback may continue.
   Unmute by gesture; no old samples replay. Interrupt mid-sentence; record detected
   event and actual silence time, drop old response frames, and ask a heard-content follow-up.
7. Hide/freeze tab, return, navigate, switch sessions, disconnect microphone and
   repeatedly enter/exit. Verify tracks/worklet/sources/sockets close; visible return
   never resumes audio without explicit gesture; the right draft/session remains.
8. Disconnect network during partial input and after durable generated completion.
   Restore within the configured recovery deadline: new epoch, no replayed old
   audio/incomplete turn/inference. Beyond deadline: restore text and committed draft.
9. Repeat with speakers/headphones and approved realistic noise; attach pilot run ID.

## Protected proxy and operations drills

All unrun until separately authorized. Verify both REST/control and WebSocket
upgrade share the same access-controlled boundary; Origin/tickets are not authentication.
Use only synthetic text/consented audio and isolated databases.
Verify /api native upgrade through actual Vite and staging proxy, timeout/session
duration, disconnect/backpressure limits, TLS/Origin enforcement, and no credential URLs.
Disable each flag independently; text remains usable and the other mode follows policy.
Exhaust configured quota, 5/20-minute caps, 60+30-second idle, shutdown/drain;
observe warning and stop reasons, no paid readiness probes and no restart loops.
Check redacted logs, no raw audio persistence, internal-record retention/deletion,
backup/restore, rollback and migration against operations.md; do not rewrite policy.
For an actual crash drill stop the sole isolated executor with bounded synthetic work,
prove it and its in-flight work are stopped, then follow the established handoff/
reconciliation procedure. Never expire/delete a sentinel to force admission. Verify
sealed-result recovery/no reinference and no-result interrupted/unknown outcomes.
Sequential runtime reconstruction in a test is not a passed hard-crash drill.

## Execution ledger

No staging drills recorded. Each row needs UTC, commit, environment, device/proxy,
authorization/consent references, procedure/check, measured result, redacted artifact,
pass/fail/block, limits and operator. Leave unavailable rows unrun or blocked.
