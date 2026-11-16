# Aurvin plugins: research brief

Date: 20 October 2026.

## User intent and current authorization

Research how Aurvin can grow into an organization-controlled work assistant, with a super admin and members, starting with Google Calendar. Explain how Codex and Claude expose plugins to their models, how the agent executes tools, and how Aurvin should persist tool activity and account for cost. The user explicitly requested thorough research before starting implementation.

The user confirmed the first experiment should use **a member connecting their own Google Calendar**. Organization-owned/shared calendars are an alternative to explain, not the selected first connection model.

This brief records the research request; it is not an approved implementation specification. Existing Phase 1 approval does not approve this scope expansion. Research and documentation are authorized now. Product design approval, implementation planning, application changes, Google project/account setup, OAuth connection, live/service calls, and deployment are later steps.

## Research questions and completion criteria

1. Define plugin, skill, connector, MCP host/client/server, tool schema, and executable tool. Explain the actual model request/call/result loop with a concrete Calendar example.
2. Compare documented Codex and Claude behavior using current primary sources. Separate public contracts from unknown proprietary internals and avoid implying that a plugin installed in Codex becomes available to Aurvin.
3. Compare direct backend tools, organization-hosted MCP, and managed connector services. Recommend a small first implementation and explain how it can support more integrations later.
4. Establish per-member Google OAuth, scopes, Calendar ACLs, Workspace administration, credential handling, and organization/member permission boundaries. Distinguish authentication, consent, authorization, and action approval.
5. Investigate Calendar creation, timezones, invitations, deterministic operation IDs, duplicate prevention, retries, and unknown outcomes after a crash.
6. Inspect Aurvin's actual current model/runtime, context, identity, admin configuration, MongoDB/checkpointer, accounting, and UI boundaries. Distinguish implemented foundations from missing capabilities and unverified deployment behavior.
7. Propose bounded, causally linked tool evidence and per-model-generation cost accounting while preserving durable transcripts, tool-result grouping, and credential isolation. Explain recovery windows that cannot be solved by a checkpoint alone.
8. Define a bounded eventual proof and meaningful fixture/native/live acceptance criteria. Document unknowns and design decisions needed before implementation; do not treat research as certification.
9. Deliver cited research artifacts and an accessible decision summary, with source retrieval dates and document/link consistency checks.

## Constraints

- Use MAW research delegation with no more than three child researchers and serialized commits. Orchestrator manages scope, state, summaries, and documentation.
- Unified review remains **skipped** under repository instructions; source verification and correction of research defects remain required.
- Preserve current application source, local configuration, and all user changes. Do not read secrets or application databases.
- Start with text chat for the proposed proof; explain voice implications without adding another unapproved feature.
- Keep current native MongoDB topology and Azure uncertainty explicit. Do not assume multi-instance or cross-collection transaction support.
- Keep proposals and tests distinct from observed facts. No paid/service/browser/account tests are authorized by a research request.
