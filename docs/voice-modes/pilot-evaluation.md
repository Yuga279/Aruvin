# Voice Modes Pilot Evaluation

Status: unrun; release gates blocked on actual measurements and approvals.
No paid calls authorized by this plan. Review is skipped, not passed.
Offline simulations and provider fixtures cannot certify hardware/provider quality.

## Authorization and dataset

Require written operator authorization identifying speech and OpenRouter account,
time/session/request/minute/spend limits, data-use/consent scope and stop owner.
Account prices/privacy/model-improvement settings are operator inputs; unknown rates
remain unknown. Enforce server quotas and keep both mode flags default-off until authorized.
Dataset minimum: 100 utterances and 30 matched no-tool multi-turn task sessions.
Include English/Indian English, names/IDs, numbers/currency/dates, attached negations,
intentional repetition, domain terms, long pauses, silence, headphones/speakers and noise.
Use consented fixtures in approved restricted storage, not production collections or
Git. Record stable IDs, reference transcripts, critical spans, accent/noise strata,
audio hashes/source rights, timing labels and adjudication; no raw audio application persistence.

## Collection and scoring procedure

1. Freeze tested commit, config, server model, provider-reported versions, keyterms,
   effective rates, topology, device/browser/region and dataset IDs. No model rewrite.
2. For each labeled utterance collect actual provider output through the React/Nest
   path. Independent grading computes corpus-weighted WER and critical-value accuracy;
   preserve repetitions/negation and evaluate formatting equivalence with documented
   canonical labels. Do not mistake exact fixture JSON echo for acoustic accuracy.
3. Timestamp recognizable speech -> visible dictation partial and Stop -> editable
   final draft. For live: last user speech sample -> first actually played output
   sample, INCLUDING turn detection; provider receipt/gateway audio is not audible playback.
   Align monotonic clocks or explicitly record clock alignment/error; report browser
   output latency/acoustic confirmation and exclude permission prompts. Cold starts
   separate. Report p50/p95 and counts per mode/browser/accent/noise stratum.
4. Capture STT, turn detection, LLM, TTS, transport/playback segments separately;
   record accepted interruption -> local silence (actual hardware), duration and idle.
   Include eligible failures in session establishment denominators; report missing,
   censored, failed and incomplete timings instead of silently discarding them.
5. Run the same 30 matched conversational task scripts with voice and text, the same
   no-tool LLM/config/context and equivalent starting sessions. Randomize order;
   independent rubric graders label final success, clarification counts, and early
   cutoffs. Compare paired success rates within 5 percentage points. Do not score
   mutation/tool tasks or infer completion from an unchanged canned fixture response.
6. Count invalid transport/session acceptance and duplicate agent executions across
   repeat/reconnect/cancel scenarios; required count zero. Authenticated tenant/tool
   authorization metrics remain deferred. Retain generated/heard/unknown distinctions.
7. Audition Haley, Alexis, Priya using identical authorized prose tasks/devices;
   record intelligibility, names/numbers/Indian English, comfort, interruptions and
   preference votes. Do not substitute an untested voice or change default silently.
8. Obtain product approval for a numeric false-interrupt tolerance and denominator
   before A15 certification; presently unspecified, blocked. Label echo/noise false
   interruptions separately from valid barge-ins and early turn cutoff (<5%).
9. Reconcile actual STT open-stream/silence minutes, TTS billing units including
   cancellations, OpenRouter usage and infrastructure with actual account invoices.
   Publish aggregate cost/session/minute, uncertainty and quota behavior; never assume
   exactly-once billing or cancellation charge prevention.

## Metrics and initial evidence

| Metric | Gate | Evidence status |
| --- | --- | --- |
| Dictation partial | p50 <=500 ms; p95 <=1000 ms | unrun |
| Dictation finalization | p95 <=2000 ms | unrun |
| First audible reply, no tools | p50 <=1500 ms; p95 <=2500 ms | unrun |
| Interruption stop | p95 <=250 ms (250 ms target) | unrun |
| Eligible granted starts ready | >=98% | unrun |
| Acoustic dictation WER | <=10% | unrun |
| Critical values | >=98% | unrun |
| Early cutoff | <5% labeled turns | unrun |
| Matched agent success | within 5 percentage points of text | unrun |
| Invalid accepts/duplicate executions | zero scoped cases | unrun |
| Echo/noise false interrupts | product-approved false-interrupt tolerance | blocked |
| Voice audition/cost/privacy/operator ownership | approved actual account/device evidence | unrun |

## Harness artifact contract and limitations

backend/test/evaluations/voice/evaluation.ts defines the bounded pilotSchema:
evidence, samples(speechEndMs/endOfTurnMs/firstPlayedMs/cold), utterances(reference/
hypothesis/critical), matched tasks(id/textSuccess/voiceSuccess), starts/ready,
earlyCutoffs/labeledTurns, invalidAcceptances/duplicateExecutions, versions(stt/tts/llm),
provenance(commit/runId/consentRef/authorizationRef). Use milliseconds in one aligned
clock, one distinct task ID per matched session, and canonical independently graded
critical spans. At least 30 warm timing samples are required; cold rows stay separate.
AURVIN_VOICE_PILOT_EVIDENCE points to the approved external JSON artifact; the offline
test validates/calculates it without making provider calls. Schema validity and a
self-declared hardware-pilot label do not authenticate provenance or certify A15,
device matrix, partial/finalization/stop timing, costs, voice auditions or privacy.
The restricted measurement ledger supplies those additional gates independently.
Record simulated arithmetic and provider-fixture normalization results separately;
neither counts toward the 100 utterances/30 actual matched-task release minimum.

## Decision and evidence ledger

No pilot results recorded. Record run ID, tested commit, UTC, verified dataset hashes,
consent/budget refs, actual model versions, n/failed/missing, p50/p95, grading/cost,
redacted artifact locations, approver and mode-specific decision. Unavailable metrics
remain blocked/unrun. Dictation and live gates are independent; no broad or public
rollout is authorized. Final verification/report remains V's responsibility.
