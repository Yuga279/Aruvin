# Product Requirements Document (PRD)
## Multimodal Live Voice Canvas Integration & Visual Choreography

**Document Status:** Approved Baseline for Implementation  
**Version:** 1.0.0  
**Date:** 2 November 2026  
**Scope:** Backend (NestJS / Durable Chat Runtime / Voice Gateway) & Frontend (React / Vite / Canvas / Live Voice)

---

### 1. Executive Summary & Vision

#### 1.1 Problem Statement
Historically, Aurvin's Live Voice Mode was intentionally architected as a voice-only "phone call" paradigm with an isolated animated bubble. Under Phase 1 rules, voice mode was strictly constrained:
- It was explicitly prohibited from producing visual outputs, code listings, tables, or Canvas diagrams ([system.md](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/instructions/system.md#L39-L41)).
- The backend filter ([speech-prose.ts](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/voice/agent/speech-prose.ts#L72-L78)) aggressively dropped all code fences and markdown blocks into the void.
- The frontend chat view ([ChatView.tsx](file:///d:/Peter/Aurvin%20Agent/Aurvin/frontend/src/features/chat/ChatView.tsx#L69)) suppressed the Canvas panel whenever voice mode was active (`!liveActive`).

This artificial limitation created a stark capability divide between Text Chat and Voice Mode. While text mode could leverage rich visual structures, Mermaid diagrams, coordinate scatter plots, and data charts, voice users were forced to listen to lengthy verbal descriptions of spatial architectures or leave voice mode entirely.

#### 1.2 The Solution
Transform Aurvin Live Voice Mode into a **Multimodal Companion**:
1. The assistant can generate any visual diagram, graph, or chart supported by Aurvin's Canvas (Mermaid diagrams, categorical bar/line/pie charts, X-Y coordinate scatter plots).
2. The raw syntax is **completely silenced** from speech synthesis (no awkward reading of brackets, code, or syntax).
3. The LLM response is choreographed in a deterministic order that **guarantees zero silence** and eliminates TTS buffer starvation.
4. When the diagram completes, the Canvas panel **slides smoothly in from the right**, allowing the user to view the visual artifact in parallel with the ongoing spoken explanation.
5. The user retains complete control to **dismiss and reopen** the Canvas panel at any time during the call.
6. The created visual artifacts and spoken explanations persist seamlessly into the conversation history upon exiting voice mode.

---

### 2. Core Principles & Zero-Silence Streaming Choreography

#### 2.1 The Streaming Latency & Velocity Asymmetry
The fundamental technical challenge in combining live speech synthesis with code generation is the velocity mismatch:
* **LLM Token Velocity:** $\approx 40\text{ to }80\text{ tokens/second}$.
* **TTS Audio Playback Velocity:** $\approx 3\text{ to }4\text{ words/second}$ ($\approx 4\text{ to }5\text{ tokens/second}$).

If an LLM emits a code block in the *middle* of a spoken response, the TTS engine may finish speaking the preceding intro while the model is still generating complex Mermaid or JSON tokens. This causes **TTS Queue Starvation**, resulting in an awkward pause, stutter, or dead-air silence.

#### 2.2 The Deterministic Three-Part Response Structure
To guarantee 100% uninterrupted audio while ensuring early visual rendering, all voice responses generating Canvas artifacts MUST strictly adhere to this sequence:

```
[Part 1: General Concept Explanation]
          ↓
[Part 2: Visual Walkthrough / Orientation]
          ↓
[Part 3: Silent Canvas Code Block (```mermaid, ```chart, ```graph)]
```

#### 2.3 The Execution Timeline
Because token generation is approximately $10\times$ faster than human speech playback:
1. **$t = 0\text{s}$:** User asks a question (e.g., *"Draw a flow chart of our authentication pipeline"*).
2. **$t = 1.5\text{s}$:** The LLM begins emitting **Part 1 (Concept Explanation)**. The first audio chunk plays immediately via Deepgram TTS.
3. **$t = 3.0\text{s}$:** The LLM emits **Part 2 (Visual Walkthrough)**. This continuous text stream completely saturates the backend audio buffer (over 20 seconds of audio queued).
4. **$t = 4.5\text{s}$:** The LLM emits **Part 3 (The Diagram Code Block)**.
   - `SpeechProse` detects the opening code fence and stops forwarding tokens to TTS.
   - The backend routes the diagram block to the frontend via a WebSocket event.
5. **$t = 5.0\text{s}$:** The LLM completes its generation. The Canvas panel **slides in from right to left** and mounts the interactive diagram.
6. **$t = 15\text{s}$ to $30\text{s}$:** The user is already looking at the fully rendered diagram while the audio playback seamlessly transitions into Part 2 (*"As you can see in the diagram now on your screen, notice how Step 2 branches..."*).
7. **Result:** Zero audio gaps, no stuttering, zero dead-air, and perfect audio-visual synchronization.

---

### 3. Functional Requirements

#### REQ-1: System Instruction Updates (`system.md`)
* In [backend/src/instructions/system.md](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/instructions/system.md), the instructions for `Response mode: voice.` shall be updated:
  * Remove the blanket prohibition against diagrams and Canvas references.
  * Authorize the LLM to emit Mermaid diagrams, charts, and coordinate graphs using Aurvin's standard syntax.
  * Mandate the three-part output order: Spoken Concept Explanation $\to$ Spoken Diagram Walkthrough $\to$ Terminal Canvas Code Block.
  * Explicitly instruct the model never to output spoken prose *after* the terminal diagram block.

#### REQ-2: Audio Prose Interception & Event Forwarding (`speech-prose.ts`)
* In [backend/src/voice/agent/speech-prose.ts](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/voice/agent/speech-prose.ts):
  * Maintain the existing behavior of stripping code fences (` ``` `, `~~~`) and tags (`<aurvin-canvas>`) from speech synthesis to ensure raw syntax is never spoken.
  * Add a listener/callback hook: when a code fence or `<aurvin-canvas>` block is detected, capture the raw block instead of discarding it.
  * Dispatch the captured block to the voice session as a structured Canvas event.

#### REQ-3: Voice Wire Protocol Enhancement (`voice-wire.ts`)
* In [backend/src/contracts/voice-wire.ts](file:///d:/Peter/Aurvin%20Agent/Aurvin/backend/src/contracts/voice-wire.ts), extend `VoiceServerPayload` with a new event:
  ```typescript
  | {
      type: 'canvas.artifact';
      turnId: string;
      responseId: string;
      kind: 'mermaid' | 'chart' | 'svg';
      subType: string;
      title: string;
      rawSource: string;
    }
  ```
* Include runtime type guards and validation ensuring corrupted or oversized blocks are handled safely.

#### REQ-4: Frontend Split-Screen Layout (`ChatView.tsx`)
* In [frontend/src/features/chat/ChatView.tsx](file:///d:/Peter/Aurvin%20Agent/Aurvin/frontend/src/features/chat/ChatView.tsx):
  * Remove the `!liveActive` gate on `showCanvasPanel`.
  * Allow `CanvasPanel` to mount side-by-side with `LiveVoicePanel` within `.aurvin-layout`.
  * The main region holding `LiveVoicePanel` flex-shrinks to the left, while `CanvasPanel` occupies the right ($380\text{px}$ to $50\text{vw}$).

#### REQ-5: Smooth Right-to-Left Slide-In Animation (`chat.css`)
* In [frontend/src/styles/chat.css](file:///d:/Peter/Aurvin%20Agent/Aurvin/frontend/src/styles/chat.css):
  * Implement an entrance keyframe animation for `.aurvin-canvas-panel`:
    ```css
    @keyframes aurvin-canvas-slide-in {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    ```
  * Ensure smooth cubic-bezier acceleration ($300\text{–}350\text{ms}$) so the transition is fluid and non-jarring.
  * Maintain clean responsive breakpoints for smaller screens / tablets.

#### REQ-6: Canvas Dismiss & Reopen Controls
* **Dismiss:** The existing tab close button and window close button `[X]` on `CanvasPanel` shall slide the panel closed and set `state.canvasOpen = false`.
* **Reopen:**
  * Add an accessible Canvas toggle button to [LiveVoiceControls.tsx](file:///d:/Peter/Aurvin%20Agent/Aurvin/frontend/src/features/voice/live/LiveVoiceControls.tsx).
  * Display a numerical badge reflecting the count of session artifacts (e.g., `[Canvas (1)]`).
  * Clicking the control toggles the Canvas panel open and closed at will without disrupting microphone capture or audio playback.

#### REQ-7: Interruption (Barge-In) Robustness
* If the user speaks or clicks "Stop speaking" while the assistant is delivering an answer:
  1. Local audio playback halts immediately ($<250\text{ms}$).
  2. The Canvas diagram that was generated **remains visible on screen** so the user can inspect it and ask follow-up questions about it (e.g., *"Wait, what is that diamond node?"*).
  3. If the user interrupted *during* the generation of the diagram, any partial or unparseable block is discarded gracefully without throwing runtime UI errors.

#### REQ-8: Post-Voice Session Persistence
* When the user clicks "Exit voice" and returns to normal text chat:
  * The voice turn, its clean spoken explanation, and the generated Canvas artifact MUST be recorded into the active session's durable messages.
  * Returning to chat displays the assistant's response bubble and inline Canvas artifact card, allowing the user to view or reopen the diagram indefinitely.

---

### 4. Technical Architecture & File Ownership

| Subsystem | File Location | Required Changes |
| :--- | :--- | :--- |
| **Instructions** | `backend/src/instructions/system.md` | Authorize Canvas in voice mode; instruct 3-part sequence. |
| **Speech Filter** | `backend/src/voice/agent/speech-prose.ts` | Intercept code fences/tags, buffer artifact, emit event. |
| **Voice Wire** | `backend/src/contracts/voice-wire.ts` | Define `canvas.artifact` server event and type guards. |
| **Voice Adapter**| `backend/src/voice/agent/agent-voice-adapter.ts` | Bridge intercepted artifacts to the active session WebSocket sink. |
| **Layout** | `frontend/src/features/chat/ChatView.tsx` | Unsuppress Canvas during `liveActive`; pass voice artifacts. |
| **Voice UI** | `frontend/src/features/voice/live/LiveVoiceControls.tsx` | Add Canvas toggle pill and badge button. |
| **Animations** | `frontend/src/styles/chat.css` | Right-to-left slide-in keyframes and split-view flex styling. |
| **Live State** | `frontend/src/features/voice/state/useLiveVoice.ts` | Handle `canvas.artifact` WebSocket event into application state. |

---

### 5. Acceptance Criteria & Test Scenarios

| Scenario ID | Test Condition | Pass Criteria |
| :--- | :--- | :--- |
| **AC-1** | Prompt asking for a diagram in voice mode | Assistant speaks intro, diagram code is 100% silenced from TTS, and audio plays without mid-stream pauses. |
| **AC-2** | Slide-in animation on diagram completion | Canvas slides in from right to left smoothly within $5\text{s}$ of turn start, before audio reaches diagram walkthrough. |
| **AC-3** | Audio synchronization | Agent voice references visual elements ("looking at the chart...") while the chart is already visible on screen. |
| **AC-4** | Canvas dismissal | User clicks [X] on Canvas; Canvas slides out; live voice audio and mic continue uninterrupted. |
| **AC-5** | Canvas reopening | User clicks Canvas button in voice controls; Canvas slides back in displaying the active diagram. |
| **AC-6** | Speech interruption (Barge-in) | User speaks over the assistant; audio immediately cuts off; the rendered diagram remains visible for follow-up questions. |
| **AC-7** | Return to chat persistence | User exits voice mode; chat transcript contains the assistant turn and Canvas card; diagram is accessible in text mode. |
| **AC-8** | Chart types parity | Works identically for Mermaid flowcharts, Mermaid sequence diagrams, categorical bar/pie charts, and X-Y scatter plots. |

---

### 6. Implementation Rollout Plan

1. **Phase 1: Backend Protocol & Wire Pipeline**
   - Update `system.md` with the three-part voice response choreography.
   - Extend `voice-wire.ts` with `canvas.artifact` contracts.
   - Update `speech-prose.ts` and `agent-voice-adapter.ts` to capture and stream visual blocks over the WebSocket.
2. **Phase 2: Frontend Layout, Animation & Toggle Controls**
   - Update `ChatView.tsx` to mount `CanvasPanel` during live voice mode.
   - Implement `@keyframes aurvin-canvas-slide-in` in `chat.css`.
   - Add the Canvas toggle icon and artifact badge in `LiveVoiceControls.tsx`.
3. **Phase 3: Interruption & Persistence Polish**
   - Verify that speech barge-in leaves the canvas mounted.
   - Hook up session persistence so exiting voice mode saves the diagram card into the chat history.
4. **Phase 4: End-to-End Verification**
   - Run Vitest integration suites across backend voice and frontend canvas.
   - Perform real-time browser audio/visual timing verification.
