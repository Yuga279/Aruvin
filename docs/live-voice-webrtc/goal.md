# Live voice over WebRTC with LiveKit

## Goal

Replace the browser-facing audio WebSocket transport in Aurvin's **live voice mode** with WebRTC using LiveKit. The aim is to reduce conversational audio latency, improve responsiveness to interruptions, and handle network jitter and packet loss more smoothly.

Dictation latency is already acceptable to the user. **Dictation mode remains unchanged.**

## Implementation principle — Ponytail

**Keep this implementation very simple: WebRTC that works, not a new voice platform.** Live voice already has noticeable latency; avoid adding unnecessary work to its critical path.

- Follow the repository's Ponytail ladder: reuse existing flows and helpers, use LiveKit's supported capabilities, and write only the minimum integration needed.
- Prefer a thin media bridge into Aurvin's current voice runtime over a broader framework migration when it satisfies the goal. Do not add parallel conversation engines, speculative abstractions, or unrelated refactors.
- Do not add extra authorization systems, repeated validation layers, redundant network round trips, or per-frame database/configuration checks. Reuse existing admission and identity handling; validate once at the relevant trust boundary where possible.
- Keep essential room-scoped access, backend-only secrets, input bounds, cancellation, resource cleanup, and existing durability/accounting behavior. Simplicity is not permission to expose credentials or lose data.
- Use focused tests and the existing benchmark tooling to prove the integration works and compare latency. Avoid creating a new validation framework or expanding into a production-hardening project. Preserve required repository regression checks; tests need not add runtime overhead.

These constraints govern the implementation plans and DAG: combine redundant work and remove ceremony rather than implementing extra layers just because the workflow lists separate work packages.

## Intended architecture

Browser ⇄ WebRTC / LiveKit ⇄ Aurvin's voice backend ⇄ speech and model providers.

WebRTC applies to the live audio path between the browser and the LiveKit media infrastructure. Provider connections may continue using WebSockets where required; this is not a requirement to remove every WebSocket from the system. Existing HTTP APIs and non-audio control transports need not be replaced merely to adopt WebRTC.

LiveKit is media infrastructure, not a drop-in protocol switch. The precise SDK/plugin integration and choice between a media bridge and a scoped LiveKit Agents integration remain implementation decisions.

## Scope and constraints

- Use LiveKit/WebRTC for microphone input and assistant audio playback in live voice mode.
- Preserve Aurvin's existing conversation orchestration and server-side ownership of accepted turns, durable history, cancellation, quotas, and usage accounting.
- Keep the existing LangGraph runtime authoritative; do not introduce a second independent conversation runtime through LiveKit Agents.
- Preserve live voice interruption behavior and ensure stopped or superseded responses do not continue playing.
- Keep provider credentials server-side. Any browser LiveKit access tokens must be short-lived, room-scoped, and issued by the backend using its established identity boundary; this does not add application authentication.
- Leave dictation and text chat behavior unchanged.

## Verification goals

Compare the new live voice path with the existing WebSocket baseline using the [conversation latency benchmark](../voice-latency-benchmark/README.md), extending it only where needed:

- Speech end to first audible assistant reply, including p50 and p95.
- User interruption to assistant playback stopping.
- Connection startup time and behavior under network jitter or packet loss.
- Continued correctness of turn lifecycle, persistence, cancellation, quotas, and accounting.
- No regressions in dictation or text chat.

WebRTC is not a guarantee of lower end-to-end latency. End-of-turn detection, model response time, TTS startup, buffering, and LiveKit placement can remain bottlenecks. Report measured results and limitations rather than assuming improvement from the transport change alone. Deployment complexity and operating cost must also be considered before rollout.

## Current boundary

This document records the agreed goal only. Implementation planning, hosting selection, deployment, and live measurements are subsequent work. It does not authorize provisioning infrastructure, paid provider calls, or public deployment.
