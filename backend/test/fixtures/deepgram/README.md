# Deepgram protocol fixtures

All committed JSON messages are synthetic, derived from official Deepgram
message schemas consulted on 8 October 2026. They are not live captures and do
not certify voice quality, service availability, actual model versions, billing,
or latency. Binary PCM in tests is generated silence, not recorded speech.

Replay: from backend, run `npm test -- test/voice/providers/resilience.spec.ts
-t "replays the documented fixture families"` on one line.

Provider captures require separate explicit operator approval, consenting test
content, credentials supplied only to the test process, bounded spend and session
duration. Capture only sanitized JSON messages and reported API/model/version
metadata. Remove keys, headers, upgrade URLs, real request IDs and personal text;
replace them consistently with deterministic fixture IDs and consenting synthetic
phrases. Do not commit raw microphone audio, account configuration, or provider
error descriptions. Record source URL, capture date, model/version, consent,
sanitization and authorization references before claiming a fixture is captured.

Routine tests use only FakeSocket; no test reads DEEPGRAM_API_KEY from the
environment or creates a real provider WebSocket. Current fixtures therefore
remain synthetic until authorized evidence is collected by P11.

Ceilings: 131072-byte provider messages, 256 pending event/send records, 32000
characters per transcript/response, default 32000-byte pending input audio and
96000-byte pending output audio. Queue overflow fails rather than silently losing
speech. Nova Stop is capped at 2000 ms; send stalls at the input queue budget;
fresh-connect recovery is capped at 10000 ms and five attempts. TTS first output
and post-Flush completion each have a 30000-ms safety deadline. These deadlines
are failure bounds, not measured latency promises.
