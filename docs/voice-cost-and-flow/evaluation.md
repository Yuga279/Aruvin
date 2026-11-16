# Voice A/B Listening and Usage Evaluation

Status: **not authorized, unrun; acoustic quality and real billing savings unverified**.
Offline fixture results are not AC8 acceptance. No microphone or provider call may be
started until the user separately consents to the device, data and bounded cost scope.

## Authorization gate

Record the consenting operator, date, approved device/browser/OS, baseline and changed
commits, server model/voice/config revisions, test identity/database, exact provider
accounts, maximum attempts/minutes/USD and data handling. Agree a hard stop, cancellation
owner and usage-inspection permission before any trial. Never use an application
database as a test substitute. Audio may be processed live only within this consent;
do not persist raw audio or enable message/audio payload logs.

## Controlled paired trials

Use identical model, voice, locale, rates, device gain and network conditions across
baseline and changed builds. Alternate A/B order. Include cold starts separately and
keep failed/cancelled trials in denominators. Stop if the consented attempt/time/cost
ceiling is reached; do not silently extend a trial to obtain a nicer percentile.

Include long silence beyond five seconds and beyond the prior 60+30-second expiry;
speech following quiet; yes/no, negations and identifiers; normal within-turn pauses;
quiet and accented speech with consenting speakers; laptop speakers and headphones;
background noise and output echo; an intentional Flux-confirmed barge-in; manual mute;
hidden/foreground transitions; detector failure; and separately bounded quota/provider
failure simulation. Background speech is not proof of address to Aurvin.

Compare initial noiseSuppression:false with the baseline configuration as a recorded
variable; keep echo cancellation enabled. Report quiet/short/accented misses and
false detections rather than assuming suppression off or an aggressive detector wins.

## Measurements

For each paired trial record scenario, success/failure/cancellation, detector onset,
decision and release delay, server listening ACK, upload frame count/bytes, elapsed
call and socket time, accepted turn/attempt identities, provider request/generation
identities, time from completed user turn to first audible playback, startup reserve,
underrun count/duration and perceived inter-sentence flow. Separate evidence-write,
LLM/safe-prose, provider and browser scheduling stalls; retain intentional provider
prosody/silence instead of trimming PCM or accelerating speech.

Report p50/p95 first audible response with sample counts and failure denominators;
pilot goals remain p50 <=1,500 ms and p95 <=2,500 ms, not fixture-established promises.
Separate cold and warm starts. Report false interruptions, missed/late short or quiet
speech, onset clipping and wake latency per device/speaker/headphone condition.

Compare observed upload savings as 1 - changed_uploaded_ms / baseline_uploaded_ms for
paired equal-duration traces with a nonzero baseline. Separately obtain actual provider
usage/billing within authorized scope, preserving request identity and unknown charges.
Do not infer invoice savings from zero-upload intervals or treat socket-open as free.

## Decision record

Until a consented run exists, result is UNRUN, not pass. A completed report must list
actual tested commits/configuration, authorized limits, attempts and failures, measured
latencies/usage, consent/data disposition, observed regressions and remaining limits.
Acoustic/billing acceptance cannot be promoted from synthetic tests or source inspection.

- [Goal and AC8](goal.md)
- [Operations](operations.md)
- [Offline verification](verification.md)
