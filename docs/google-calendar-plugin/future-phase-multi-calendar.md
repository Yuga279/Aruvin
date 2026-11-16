<!--
============================================================================
FILE: future-phase-multi-calendar.md
LOCATION: docs/google-calendar-plugin/future-phase-multi-calendar.md
============================================================================

PURPOSE:
   Roadmap specification and architecture guide for Phase 2: Dynamic
   Multi-Calendar Discovery & Conversational Target Selection.

ROLE IN PROJECT:
   Provides the complete blueprint and requirements for expanding Aurvin from
   a single server-pinned test calendar to multi-calendar awareness,
   in-app calendar selection, and natural-language calendar targeting.

KEY COMPONENTS:
   - Scope & OAuth adjustments (adding calendarlist permissions)
   - Calendar discovery & metadata caching
   - MCP tool extensions (calendar discovery, target parameter)
   - Conversational ambiguity resolution in chat runtime
   - Frontend dashboard calendar picker UI
   - Step-by-step rollout instructions
============================================================================
-->

# Roadmap: Dynamic Multi-Calendar Discovery & Conversational Target Selection

**Status:** Planned / Deferred (To be initiated at user request)  
**Parent Epic:** Google Calendar Plugin (`docs/google-calendar-plugin/`)  
**Previous Phase:** Phase 1 — Single disposable target calendar pinned via `backend/.env` with narrow `calendar.events.owned` scope.

---

## 1. Executive Summary & Objective

In **Phase 1**, Aurvin connects to a single, hardcoded calendar ID configured via `AURVIN_GOOGLE_CALENDAR_TARGET_ID` in `.env`. This provided an ironclad security sandbox during initial testing and avoided broad Google permissions.

In **Phase 2 (this phase)**, Aurvin will adopt **Google Gemini's interaction model**:
1. **1-Click Connect (Zero Setup):** User connects once; no calendar IDs to copy, no `.env` editing required.
2. **Discover Available Calendars:** Automatically retrieve all calendars the user owns or has access to (e.g. "Primary / Personal", "Work", "Project Apollo", "Family").
3. **Conversational Multi-Calendar Targeting (Gemini Model):** Default to `primary` with no friction, listen for specific calendar names, and actively clarify when ambiguous.
4. **Cross-Calendar Availability & Conflict Checking:** Check busy/free intervals across all writable/readable calendars to ensure meetings do not clash.

### Phase 1 vs. Future Phase Comparison

| Feature | Phase 1 (Current Prototype) | Future Phase (Gemini Model) |
| :--- | :--- | :--- |
| **Connection Setup** | Manually create a test calendar and paste its ID into `.env`. | **1-Click Connect:** Click "Connect", sign in to Google, and done. No `.env` edits or ID copying. |
| **Calendar Visibility** | Strictly locked into **one** test calendar. | Automatically discovers **all** calendars in background (Work, Personal, Fitness, etc.). |
| **Default Scheduling** | Always lands on the single configured test calendar. | **Automatic Primary:** Saying *"Schedule a dentist visit"* automatically puts it on main calendar. |
| **Named Calendars** | Cannot route to different calendars. | **Smart Routing:** Saying *"Put this workout on my Fitness calendar"* routes it there. |
| **Ambiguity Handling** | None (only one calendar exists). | **Conversational Asking:** If unclear where an event belongs, asks: *"Should I put this on 'Work' or 'Personal'?"* |
| **Conflict Checking** | Only checks events on the single test calendar. | **Cross-Calendar Awareness:** Reads across all calendars to ensure work calls don't clash with personal appointments. |

---

## 2. Google OAuth & Scope Requirements

To list and interact with multiple calendars dynamically, Google's API requires additional scope permissions:

| Scope | Purpose | Sensitivity Level |
|---|---|---|
| `openid` | OIDC Subject identification (existing) | Non-sensitive |
| `email` | Display email address (existing) | Non-sensitive |
| `https://www.googleapis.com/auth/calendar.events.owned` | Read/write access to events on calendars owned by user (existing) | Sensitive |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | **NEW:** Fetch list of user calendars, names, colors, and access roles | Sensitive |
| `https://www.googleapis.com/auth/calendar.events` *(Optional)* | Only if write access to shared/team calendars (not owned by user) is needed | Sensitive / Restricted |

> [!NOTE]
> For internal Workspace apps (`@ecgroup-intl.com`), adding `calendar.calendarlist.readonly` requires no public verification. If using an External Google Cloud project in Testing mode, test users can authorize immediately.

---

## 3. User Experience & Flows

### Flow A: Dynamic Calendar Discovery in Settings UI
1. User connects Google Calendar via the existing OAuth flow.
2. Upon successful OAuth callback, Aurvin calls `calendarList.list` to discover all available calendars.
3. The Admin Dashboard (`GoogleCalendarPanel.tsx`) replaces the static text `<dd>{status.targetCalendarId}</dd>` with a **Calendar Selector Dropdown**:
   - Lists calendars: e.g. `[Work (Primary), Personal, Aurvin Test]`
   - Displays user's role on each calendar (Owner, Writer, Reader).
   - Allows user to set the default calendar for new events.
4. Selection is saved via `PATCH /api/plugins/google-calendar/settings` into the user's connection record in MongoDB (no `.env` edit or backend restart required).

### Flow B: Intelligent Conversational Target Resolution (Gemini Model)
Rather than requiring the user to manually pick a calendar up front, Aurvin adopts the same 3-tier heuristic model as Google Gemini:

1. **Default to Primary Calendar (Zero Friction):**
   - If the user says: *"Add a dentist appointment tomorrow at 10 AM"* without mentioning any calendar, Aurvin automatically places it directly onto their main Google Calendar (`primary`). No questions asked, no dropdown selection needed at connect time.
2. **Listening for Specific Calendar Names:**
   - If the user names a calendar: *"Add a review meeting to my Work calendar"* or *"Put this workout on my Fitness calendar"*, Aurvin matches the name against discovered calendars and routes the event to that specific calendar.
   - Fuzzy matching handles variations (e.g., "work cal", "my job schedule").
3. **Conversational Clarification when Ambiguous:**
   - If context is genuinely ambiguous between overlapping writable calendars, Aurvin briefly clarifies: *"Would you like me to schedule this lunch on 'Work' or 'Personal'?"*
   - Once answered, Aurvin creates the event on the confirmed calendar.

### Flow C: Optional Settings Override (For Operators)
For users who prefer a non-primary default (e.g. defaulting all AI events to a dedicated secondary calendar), the Settings panel will offer an optional default calendar dropdown. But selecting one is completely optional—by default, Aurvin simply works out of the box like Gemini.

---

## 4. Technical Architecture & Component Changes

```
┌────────────────────────────────────────────────────────┐
│                      FRONTEND                          │
│  - GoogleCalendarPanel: Calendar Picker Dropdown       │
│  - Chat View: Visual calendar badge on scheduled card  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  BACKEND / API LAYER                   │
│  - GET  /api/plugins/google-calendar/calendars         │
│  - PATCH /api/plugins/google-calendar/settings         │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│             CALENDAR CONNECTION & STORAGE              │
│  - Discovered calendars cache in ConnectionRecord      │
│  - Active/Default calendar ID in ConnectionRecord      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                 MCP / AGENT RUNTIME                    │
│  - list_calendars tool (returns available calendars)   │
│  - list_events / create_event accept calendar_id       │
│  - System prompt instructions for target clarification │
└────────────────────────────────────────────────────────┘
```

### 4.1 Persistence Schema Updates (`contracts/calendar-connections.ts`)
Extend `CalendarConnectionRecord`:
```typescript
export interface DiscoveredCalendar {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
}

// Added to connection record:
export interface CalendarConnectionRecord {
  ...
  availableCalendars: DiscoveredCalendar[];
  activeCalendarId: string; // Current default
}
```

### 4.2 Embedded MCP Tool Updates
1. **`list_calendars` Tool:**
   - Input: `{}`
   - Output: List of `{ id, name, isPrimary, canCreateEvents }`
   - Annotated with high-cache lifetime (refresh on connection changes).
2. **`list_events` & `create_event` Tool Parameters:**
   - Add optional `calendarId?: string` parameter.
   - If omitted, default to `activeCalendarId`.
   - Validate that `calendarId` is in `availableCalendars` and has `accessRole === 'owner' | 'writer'`.

### 4.3 Chat Runtime & Prompt Engineering (`instructions/system.md`)
Add guidelines for calendar selection:
```markdown
### Calendar Selection Guidelines
- When the user asks to schedule an event and specifies a calendar (e.g., "on my work calendar"), resolve the target using available calendars.
- If the user has multiple calendars and the context does not specify which one to use, ask a brief clarifying question listing the options rather than guessing.
- Never write to a read-only or subscribed calendar.
```

---

## 5. Implementation & Execution Plan

When you are ready to kick off this phase, follow these sequential steps:

### Step 1: Google Cloud Console Configuration
- In Google Cloud Console → **APIs & Services → OAuth consent screen**:
- Add scope: `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
- Save consent screen changes.

### Step 2: Backend Protocol & Service Layer
- Update `CALENDAR_SCOPES` in `backend/src/contracts/calendar-policy.ts` to include `calendar.calendarlist.readonly`.
- Implement `fetchCalendarList()` in `backend/src/plugins/google-calendar/calendar-api.ts`.
- Store discovered calendars in `connectionRecord` upon OAuth callback and provide a refresh route (`POST /api/plugins/google-calendar/calendars/refresh`).
- Add endpoint `GET /api/plugins/google-calendar/calendars`.

### Step 3: MCP Tool & Model Wiring
- Extend MCP tool schema in `backend/src/plugins/google-calendar/mcp-adapter.ts` to expose `list_calendars` and parameterize `calendarId` in `create_event`/`list_events`.
- Update runtime validation in `backend/src/plugins/google-calendar/runtime-gate.ts` to verify permissions against the specified `calendarId`.

### Step 4: Frontend UI Enhancement
- Update `frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx` with the calendar selection dropdown.
- Add test coverage for calendar list loading, switching active calendar, and error handling.

### Step 5: Verification & Safety Drills
- Verify that attempting to write to a read-only calendar fails gracefully with clear user feedback.
- Verify that ambiguous schedule requests trigger conversational clarification instead of silent default assumption.
- Run regression tests on existing Phase 1 single-calendar workflows.

---

## 6. How to Start This Phase

To begin working on this phase in a new chat or workflow:
1. Mention this file: `@[docs/google-calendar-plugin/future-phase-multi-calendar.md]`.
2. Instruct the assistant: *"Let's begin Phase 2: Dynamic Multi-Calendar Discovery as specified in this roadmap."*
3. The workflow will proceed systematically through Steps 1–5 above.
