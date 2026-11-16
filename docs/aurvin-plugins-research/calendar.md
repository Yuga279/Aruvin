# Google Calendar integration research

Research date: **20 October 2026**. Scope: research and recommendations only. The selected first experiment is **a member connects their own Google Calendar**. No OAuth app, cloud service, credential, database record, Calendar event, or paid test was created during this research. Documentation discovery is evidence about published interfaces; it is not evidence that Aurvin has connected or executed them.

## Recommended decision

Use per-member Google OAuth and a small server-owned Calendar adapter exposing only bounded event listing, event retrieval, and creation. Initially allow one member-owned test calendar, ordinary one-off events, and no attendees. Keep the executor, credential access, authorization, action ledger, and retry policy in Aurvin. This is the smallest experiment that can demonstrate that a natural-language request becomes a real, auditable Calendar action.

If the learning objective includes proving MCP interoperability, expose those same three operations through a tiny organization-hosted MCP server after the adapter behavior is proved. That second step demonstrates discovery and invocation over MCP without changing Google authorization or the safety semantics. A direct adapter proves the Calendar action; a working MCP client/server connection proves the protocol integration. Record those as separate acceptance claims.

There is now a first-party Google Calendar remote MCP option. It is a real candidate, but its preview availability, broader documented write scope, and creation retry limitations make it a separate evaluation path. A universal plugin marketplace, arbitrary remote server installer, multi-provider broker, and domain-wide impersonation are unnecessary for the selected first experiment.

## Three integration routes

| Route | What Aurvin owns | What it proves | Material tradeoff |
| --- | --- | --- | --- |
| Direct Calendar API behind Aurvin tools | OAuth, tool schema, policy, adapter, ledger and execution | Model-selected tools can read/create actual events | No MCP interoperability claim; maximum control over request IDs and returned fields |
| Organization-hosted MCP wrapper around that adapter | The same controls plus MCP server and client boundary | Tool discovery and invocation work over MCP | Extra protocol/session/auth surface; still calls Google's API and needs member OAuth |
| Google-hosted Calendar MCP | Aurvin host, member connection, filtering, policy and ledger; Google hosts adapter | Compatibility with Google's managed tool interface | Developer Preview admission and client compatibility; published create interface gives less retry control |

Google documents `https://calendarmcp.googleapis.com/mcp/v1` with Streamable HTTP, OAuth, and membership in its Workspace Developer Preview Program. Its configuration guide lists read and write tools, and requires an OAuth client marked for an AI-powered agent. This establishes **documented availability**, not eligibility for Aurvin's organization, general availability, or successful arbitrary-client interoperability. The guide was updated on 12 October 2026. [Google Calendar MCP configuration](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server)

The preview `create_event` reference requires `calendar` or `calendar.events`; it does not list the narrower `calendar.events.owned`. Its input schema exposes neither an event ID nor extended properties, and its idempotent annotation is false. The notification enum defaults to `ALL`, and a supplied time zone overrides timestamp offsets. Those are important differences from a carefully restricted REST adapter. [Google MCP create_event reference](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/create_event)

The configuration guide's example scope set is read-only even though write tools are listed. Treat that example as insufficient for creation and reconcile against the individual tool reference and actual granted scopes. For a future preview spike, establish project admission, discover actual tools and schemas, test write authorization, and demonstrate refresh behavior before choosing it. Do not assume MCP conformance alone supplies the needed Google-specific OAuth parameters. Google's general MCP guide explains that `offline_access` alone does not obtain a refresh token: the client must support `access_type=offline`, with re-consent where needed. [Google Workspace MCP client configuration](https://developers.google.com/workspace/guides/configure-mcp-servers)

Third-party managed MCP services are a fourth commercial arrangement, not a different Google permission model. If considered later, evaluate who becomes OAuth client, who stores refresh tokens, who receives Calendar bodies, which subprocessors/models can receive data, revocation/export controls, server/tool version changes, retry semantics, and separate fees. This report does not endorse or certify a third-party broker.

## Member OAuth and connection lifecycle

The recommended flow uses a confidential server-side authorization-code client. Google redirects the browser with a code; Aurvin's backend exchanges it and stores the resulting member-specific grant. Request `access_type=offline` when continued access is needed. The redirect URI must match the registered URI, and Aurvin must inspect granted scopes rather than assuming every requested scope was approved. Google's guide also documents account selection and re-consent options. [OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)

Use a fresh S256 PKCE challenge/verifier in the selected supported client flow. Google's current Node auth-library options document `code_challenge` and `code_challenge_method`, including S256. This is library capability evidence; the exact library version/client configuration must be pinned and exercised in implementation. PKCE supplements the server's confidential-client requirements and does not replace binding the callback to the initiating Aurvin member. [Google auth-library authorization options](https://docs.cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/generateauthurlopts)

Google recommends secure credential storage, encryption of multi-user server token stores, non-guessable validated OAuth `state`, incremental permission requests, and revocation/deletion of unneeded tokens. [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)

Proposed Aurvin requirements:

1. Authenticate the Aurvin member before beginning connection. Bind a short-lived, single-use OAuth state and PKCE verifier to that server session, organization, member and intended integration. Never accept the final connection owner from model arguments or arbitrary browser identifiers.
2. Keep organization OAuth client secrets in server-managed secret storage. Keep refresh tokens encrypted in a credential store, with only an opaque credential reference in ordinary connection records. If MongoDB holds ciphertext, manage the encryption key separately and include key rotation and backup access in the design.
3. After the callback, bind the verified Google account to the connection, show the chosen account and permitted calendar to the member, and record actual scopes. Account hints and email text from the model are not proof of ownership. Use verified provider identity rather than an editable display label as the durable account binding.
4. Resolve the connection and fixed calendar from the authenticated member at invocation time. The LLM receives an operation description and safe schema, not Google tokens, OAuth codes, client secrets, refresh responses or credential-store records.
5. Serialize refresh/update for a connection so concurrent calls cannot accidentally overwrite newer credentials. Preserve a valid stored refresh token if a later exchange omits a replacement. Fail closed and mark reconnect-required on nonrecoverable authorization loss.
6. Distinguish **disable integration**, **disconnect this Aurvin connection**, **revoke Google's project grant**, and **delete retained data** in product behavior. Account switching creates a new binding and invalidates pending actions against the old binding; it must not silently retarget an already-authorized action.

Refresh tokens can cease working because of revocation, inactivity, account token limits or administrative policy. For an External app in Testing, Calendar authorization normally produces a refresh token that expires after seven days; identity-only exceptions do not cover Calendar. Published status does not promise permanent refresh tokens. [Google OAuth token lifetime rules](https://developers.google.com/identity/protocols/oauth2/)

Internal apps are restricted to their Workspace organization and do not require ordinary public-app verification. External Testing normally uses an allowlist capped at 100 test users; public verified distribution is a different launch decision. Google documents that Workspace administrator trust can override some testing/token limitations for that organization's users. Establish the actual tenant/app state before predicting consent screens or expiry. [OAuth app state and administrative overrides](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)

Google's revocation endpoint has a wider blast radius than a single local Calendar connection: its web-server guide says revocation removes scopes granted to the project and invalidates associated access/refresh tokens across that project's clients for the grant. Future Calendar/Drive/Sheets connections sharing a project therefore need a deliberate disconnect design. Revoke and remove secrets when appropriate, but do not describe local deletion as provider revocation. [OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)

The credentials guide now offers an AI-agent client flag and recommends separate clients for agent and ordinary features. Its web-app section contains a statement about client secrets that should be reconciled with the confidential web-server flow documentation during implementation; do not copy a browser-only sample into backend token handling. [Create Google access credentials](https://developers.google.com/workspace/guides/create-credentials)

## Scope selection, Google access and Aurvin roles

These are independent layers:

| Layer | Question it answers | Aurvin consequence |
| --- | --- | --- |
| Aurvin authentication and RBAC | Which organization/member is making this request, and may they use this tool? | Enforce on the server for every call |
| Google OAuth scopes | Which categories of Calendar operations did this Google account grant the client? | Request narrowly; verify the returned grant |
| Calendar ACL and event ownership | Can that Google account operate on this particular resource? | A valid token alone is insufficient |
| Workspace administrator controls | May this client access this organization's services/scopes? | Admin blocks can override user consent |
| Action authorization | Did the member request this actual side effect? | Bind arguments, target and approval to the action |

Relevant official scopes are:

| Scope suffix, under `https://www.googleapis.com/auth/` | Documented capability | Candidate use |
| --- | --- | --- |
| `calendar.events.owned` | Read/create/change/delete events on calendars the user owns | Recommended REST proof scope for the selected own-calendar experiment |
| `calendar.events.owned.readonly` | Read events on owned calendars | Optional read-only onboarding stage |
| `calendar.events` | Read/edit events across the user's calendars | Needed for broader writable shared-calendar support; not initial default |
| `calendar.app.created` | Create secondary calendars and manage events on them | Alternative if Aurvin specifically creates a dedicated calendar |
| `calendar.calendarlist.readonly` | Read the user's subscribed calendar list | Only if a calendar picker is needed |
| `calendar.calendars.readonly` | Read calendar properties, including default time zone | Only if the implementation needs that separate metadata API |

The broad `calendar` scope also permits calendar sharing/deletion and is unnecessary for this proof. None of these scopes means "only the one calendar picked in Aurvin." Enforce that narrower restriction in Aurvin's adapter even when the Google token can access more. [Official Calendar scope definitions](https://developers.google.com/workspace/calendar/api/auth)

A shared organizational calendar is a different case. A member's Calendar ACL role can provide write access; the `owner` ACL role and the single calendar data owner are distinct concepts. Domain sharing policies may further restrict access. Therefore, do not promise that `calendar.events.owned` covers any calendar with a reassuring UI role label: validate the target and scope together, and use the broader events permission only when the shared-calendar requirement is approved. Private event visibility is not isolation from users with writer access. [Calendar sharing and ACLs](https://developers.google.com/workspace/calendar/api/concepts/sharing)

Workspace administrators can classify clients as Trusted, Specific Google data, Limited or Blocked, and restrict Calendar service access. For organizational rollout, review the actual OAuth client IDs and required scopes through Admin Console API Controls; Aurvin's super admin and Google's Workspace super admin are different authorities. [Google Workspace app access controls](https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data)

Domain-wide delegation lets an administrator authorize service-account access on users' behalf. Google advises preferring direct access or OAuth consent where those satisfy the need, limiting scopes, and protecting delegated service accounts. It increases the impact of a compromised executor and is unnecessary when a member can authorize their own Calendar. Personal Gmail accounts do not supply a Workspace domain-wide-delegation route. [Domain-wide delegation best practices](https://knowledge.workspace.google.com/admin/apps/domain-wide-delegation-best-practices), [Google authorization overview](https://developers.google.com/workspace/guides/auth-overview)

Service accounts are also not a shortcut to creating member-owned calendars: Google warns that authenticating calendar creation as a service account makes it the data owner and can prevent ownership transfer. [Calendars and ownership](https://developers.google.com/workspace/calendar/api/concepts/events-calendars)

## Calendar behavior the adapter must preserve

### Concrete target and bounded reads

Resolve the target server-side; `primary` means the currently authorized Google user's primary calendar. For the proof, an explicitly configured member-owned secondary test calendar offers a smaller affected dataset than a working primary calendar. A member can create that calendar manually, so testing event creation does not require adding calendar-creation capability to Aurvin.

The REST listing interface has page tokens, with defaults much larger than the proof needs. `timeMin` filters event **end**, while `timeMax` filters event **start**; both are exclusive bounds with RFC3339 offsets. `orderBy=startTime` requires `singleEvents=true`. Empty pages do not establish that there are no more results when a next-page token exists. [Events.list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)

Proposed initial limits, to be confirmed during planning: one authorized calendar, a maximum 31-day read window, at most 20 results per page, at most three fetched pages per action, a bounded response byte/token budget, finite deadlines/retries and one creation per user-authorized action. Return truncation/continuation explicitly; never claim a partial list is complete. Return only fields needed by the request. Retrieval should require a known provider event ID and the same authorized target. [Events.get interface](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)

### Dates, time zones and daylight saving

Timed REST events use RFC3339 start/end values with offsets unless an explicit time zone is supplied; Calendar accepts IANA time-zone names. The event end is exclusive. User-supplied IDs use only `0-9` and lowercase `a-v`, are 5–1024 characters, and must be unique per calendar. Google cautions that distributed ID-collision detection is not guaranteed. [Events.insert contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

Both endpoints must be either date-times or all-day dates. All-day events use date-only values; their time-zone field has no significance. For one day on 22 October, the dates are start `2026-10-22`, end `2026-10-23`. [Timed versus all-day event model](https://developers.google.com/workspace/calendar/api/concepts/events-calendars)

Proposed Aurvin validation: reject end-before-start, mixed date/date-time fields, invalid date-only values and impossible local times. Resolve relative phrases using the member's declared time zone and an explicit current date, not the backend host's zone. Preserve an IANA zone for local scheduling. If a daylight-saving transition makes a time nonexistent or ambiguous, ask for the intended actual time/offset instead of silently normalizing. The selected proof can initially reject recurrence and unsupported all-day requests with a useful explanation, but must still test that they cannot be accidentally interpreted as ordinary timed events. Do not silently assume a duration when the user has not agreed a default.

### Create idempotency and uncertain outcomes

Google explicitly recommends client-generated event IDs to connect local records and avoid duplicate insertion after an operation succeeds remotely but fails locally. Allocate the ID once for the **logical action**, persist it before the outbound request, and reuse it after disconnects, executor recovery, duplicate submissions and model retries. A lowercase UUID rendered without hyphens is within the permitted alphabet; retain the durable mapping rather than asking the model to regenerate it. [Creating events with application IDs](https://developers.google.com/workspace/calendar/api/guides/create-events)

The following is an Aurvin recommendation, not an exactly-once guarantee:

1. Persist member/organization/connection version, target calendar, stable provider event ID, canonical approved payload/hash, originating turn/tool call, policy decision and dispatch state.
2. Execute the create once the persisted action is authorized. Save its result and provider reference before reporting confirmed success to the user.
3. After a timeout or crash around dispatch, mark the action's outcome uncertain and get the same event ID on the same calendar/account. Compare the resource and linkage with the approved action before accepting it as that action's result.
4. If found and matching, finish local finalization without inserting another event. If a duplicate-ID response arrives, reconcile rather than generating a fresh ID. A mismatching object is a conflict requiring intervention, not permission to overwrite it.
5. If it cannot be established whether the event exists, keep the outcome uncertain and use a bounded reconciliation policy. A transient not-found response is not an unlimited retry license. An explicit new user request for another event gets a new action ID.

Google documents duplicate identifiers as HTTP 409; transient quota/backend errors have backoff guidance. Distinguish permanent bad input, lost authorization, rate limits, non-organizer restrictions and uncertain mutations. Retry only within finite policy budgets. Recovery must not rerun inference merely to rediscover an already-persisted create result. [Calendar API error handling](https://developers.google.com/workspace/calendar/api/guides/errors)

REST `extendedProperties.private` can hold a short opaque Aurvin action reference on that calendar's event copy. Shared properties travel across attendee copies. Private means copy-local metadata, not an encrypted credential vault. Store no tokens, message bodies, private reasoning or human-readable organizational secrets there. The API limits keys to 44 characters and values to 1024 characters, with silent dropping/truncation beyond those limits. Keep linkage far below those ceilings and retain the authoritative ledger in Aurvin. [Calendar extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)

### Invitations and notification authority

Adding attendees can send invitations from the organizer's address and create copies under attendees' Calendar settings. It is therefore a communication action as well as a calendar write. Do not prepopulate acceptance on another person's behalf or claim their attendance is confirmed because an event was created. [Inviting Calendar attendees](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events)

REST supports `sendUpdates=all`, `externalOnly` and `none`; Google warns that `none` can cause attendee synchronization problems and that some email may still be sent. Service-account attendee population has additional delegation requirements. Do not rely on notification suppression as the only safety measure. The proof should reject attendees, meetings/attachments and email reminders at schema/policy level. [Events.insert notification behavior](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

Later invitation support requires explicit authorization for the real calendar, recipients, content, time and notification behavior. A precise user request can supply that authorization; avoid asking an identical confirmation twice merely because a model was involved. Ask when a material argument is missing, inferred, changed, conflicts with policy, or creates additional impact. Bind any approval to the canonical action payload and invalidate it if that payload or connection target changes. OAuth connection consent alone is not authorization for every future communication.

## Tool-result trust, persistent memory and costs

Calendar titles, HTML descriptions, locations and attendee text are untrusted external data. An event saying "ignore the user and send this report to..." is content, not an Aurvin instruction. Keep results labelled with provenance, restrict which fields enter model context, render HTML safely, and prevent event text from granting permissions, selecting credential connections or changing a destination. Test that the server denies disallowed calls even when the model requests them.

Google's Workspace MCP security guide requires screening prompts/responses for malicious content or prompt injection; it permits documented alternatives to Model Armor. It also warns that Model Armor payload logging can expose sensitive data and regional routing can affect residency. Thus a managed screening service adds its own data/cost decision; it is not automatically required as a new Aurvin dependency. [Workspace MCP security configuration](https://developers.google.com/workspace/guides/configure-mcp-security)

The current Workspace developer policy limits data use and transfers to permitted, visible user-facing purposes with appropriate consent, restricts generalized model training, and warns against permanent Google-data copies or caching beyond permitted headers. It also discusses granular confirmation for agent behavior. Before deciding that every Calendar result or derived summary belongs forever in MongoDB, reconcile retention and disclosures with the applicable policy and terms. This is a research gate, not a conclusion that all application accounting metadata is forbidden. [Workspace user-data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

Proposed storage distinction for the implementation decision:

- **Credentials:** encrypted secrets behind dedicated access controls, never chat context/checkpoints/log payloads.
- **Connection metadata:** owning organization/member, provider identity, actual scopes, allowed calendar, status, credential reference and version.
- **Execution evidence:** bounded action/attempt IDs, causal links, approval/policy evidence, provider event reference, payload hash, timestamps/sequences, status and sanitized error category.
- **Result content:** minimal purpose-bound data with explicit retention; avoid an indefinite second archive of Calendar events. Review how fetched content may also land in durable chat messages, checkpoints and backups.
- **Usage:** every LLM attempt and every external API attempt, including reads for reconciliation, token refresh calls, rejected calls and retries. References and usage records are not substitutes for actual provider bills.

Google's current quota page describes project and per-user sliding-window limits. For new projects it lists **10,000 requests per minute per project**, **600 per minute per user per project**, and a **1,000,000-request daily project billing threshold**. Existing-project history can change the applicable quota. It still describes standard use as no additional cost while warning of planned overage charges later in 2026. Verify the project's real console limits and current billing notices when implementation begins; do not promise free use forever or invent an overage price. [Calendar usage limits and pricing](https://developers.google.com/workspace/calendar/api/guides/quota)

Google's cross-Workspace tiering page says API usage above standard daily thresholds is planned to become billable after notice, with billing-enabled quota increases. It includes MCP in the standardized model. The retrieved pages do not establish the actual future dollar rate or Aurvin's account billing state. [Workspace API and agent-tool tiering](https://developers.google.com/workspace/tools-safety)

Aurvin's cost view should therefore separate model spend, Calendar API usage, optional MCP broker/service fees, screening, storage and infrastructure. A Calendar tool call can trigger several model calls and several HTTP attempts; counting only the successful create understates work. Record monetary amounts only from known rates or provider-reported charges, label estimates and unknowns, and attribute by organization/member/turn/logical action/attempt. Include tool schema and bounded result tokens in model context accounting.

## Proposed proof and acceptance evidence

These are future acceptance checks, **not executed results**. The proof needs explicit authorization before connecting Google or performing live calls, with the exact account/calendar, allowed operations and request budget stated.

| Check | Required evidence |
| --- | --- |
| Correct member connection | Member A's connection cannot be read or used by member B; forged identifiers fail server-side |
| OAuth callback protection | State mismatch/reuse/expiry and wrong PKCE verifier fail; no token appears in browser history, app logs or model input |
| Permission behavior | Missing/denied scopes disable creation; revoked/blocked grants lead to reconnect-required with no silent credential substitution |
| Target restriction | Attempts to change calendar/account through tool arguments fail even if the token has broader access |
| Bounded reads | Window/page/byte/deadline limits hold, partial results are labelled, and unsafe HTML is rendered safely |
| Normal create | A precise authorized request produces one ordinary event in the test calendar; response, get/readback, UI link and durable action record agree |
| Time correctness | Explicit-offset, member-zone, DST ambiguity and invalid mixed/all-day inputs behave as specified |
| Duplicate submission | Repeated delivery and graph replay reuse the logical action and event ID; one event is observed |
| Uncertain create | Inject timeout after a simulated remote success, crash around result persistence, then reconcile by the saved ID without a second create |
| Conflict handling | Existing mismatched event/409 does not cause overwrite or fresh-ID insertion |
| Side-effect boundaries | Attendees, invites, recurrence, attachments, Meet creation and unrelated writes are rejected in the first experiment |
| Prompt injection | Malicious event description cannot cause an unauthorized call, change a connection, or leak unrelated data |
| Accounting | Every provider/model attempt is attributed; retry/reconciliation costs and unknown rates are visible separately |
| Disconnect/account switch | New calls stop; queued approval against the former connection is invalid; local deletion and Google revocation are distinguished |
| MCP, if included | Actual initialize/discovery/call paths work; only allowlisted tools are exposed; the same authorization and retry checks remain enforced |

Suggested controlled live run after fixture coverage: connect one consenting member; select a manually created disposable member-owned calendar; list a tiny explicit date range; create one event without guests or email reminders; read that event back and open its Calendar link; verify the action/usage ledger; disconnect. State a hard maximum API-request count and model budget before the run. Cleanup can be manual, or separately authorize deletion of that exact test event; do not add a general delete tool solely to clean up the experiment.

Do not mark the experiment accepted from a textual model claim, a schema appearing in a tool list, a mocked HTTP 200, or a Google configuration screen alone. The decisive evidence is a correctly authorized real event, durable result handling and bounded isolated verification. Keep this proof distinct from certification of public deployment, member authentication, multi-tenant isolation at scale, Azure persistence compatibility or production Google verification.

## Remaining decisions and unknowns

1. The member-owned route is selected, but whether the initial account is managed Workspace or personal Gmail, and whether a disposable secondary calendar is acceptable, still affects consent configuration and testing.
2. Aurvin's trusted member/organization identity must exist for an organizational rollout. A hardcoded local user may support an explicitly isolated learning harness, but does not establish member RBAC.
3. The Google project, actual OAuth app state, administrator restrictions, existing quota history, exact granted scope and billing account have not been inspected.
4. Google's first-party MCP is preview-gated. Admission, current deployed tool schemas, write-scope behavior, offline refresh, client compatibility and action-reconciliation affordances remain untested.
5. Long-term retention of Calendar bodies/derived content and model-provider data handling must be resolved before enabling durable ingestion of real organizational data.
6. Initial action limits above are proposed ceilings for the proof. Implementation planning must choose and test concrete limits and budgets; none is claimed to exist in Aurvin today.

## Official source register

All sources below were fetched or returned by official-source search on **20 October 2026**. URLs link to the specific primary documentation; dates stated in the text are page metadata, not deployment guarantees. Derived summaries are intentionally concise per source, and implementation recommendations are identified as Aurvin proposals.

| Source | Evidence used |
| --- | --- |
| [Calendar MCP configuration](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) | Official endpoint, preview gate, protocol/client configuration |
| [Calendar MCP create_event](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/create_event) | Input/scopes/defaults and idempotent annotation |
| [Workspace MCP configuration](https://developers.google.com/workspace/guides/configure-mcp-servers) | Google-specific refresh/client requirements |
| [Web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) | Code flow, offline access, grant inspection, revocation |
| [Auth-library options](https://docs.cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/generateauthurlopts) | PKCE S256 interface |
| [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) | State, secure token storage and cleanup |
| [OAuth overview](https://developers.google.com/identity/protocols/oauth2/) | Token expiry and seven-day Testing rule |
| [OAuth app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) | Internal/External, verification, admin overrides |
| [Create credentials](https://developers.google.com/workspace/guides/create-credentials) | AI-agent client flag and credentials distinctions |
| [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) | Least-privilege scope definitions |
| [Calendar sharing](https://developers.google.com/workspace/calendar/api/concepts/sharing) | ACLs, private-event access and domain limits |
| [Workspace app access](https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data) | Admin service/client controls |
| [Delegation best practices](https://knowledge.workspace.google.com/admin/apps/domain-wide-delegation-best-practices) | Avoid unnecessary domain-wide delegation |
| [Authorization overview](https://developers.google.com/workspace/guides/auth-overview) | User/service-account/delegation distinction |
| [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) | Ownership, timed/all-day behavior |
| [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) | Bounds and pagination |
| [Events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get) | Readback interface |
| [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | IDs, time fields and notification caveats |
| [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events) | Client-generated IDs and duplicate prevention |
| [API errors](https://developers.google.com/workspace/calendar/api/guides/errors) | Duplicate-ID and retry classifications |
| [Extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties) | Private/shared linkage and bounds |
| [Invite attendees](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events) | Organizer communication and attendee effects |
| [MCP security](https://developers.google.com/workspace/guides/configure-mcp-security) | Screening, logs and residency considerations |
| [Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) | Data use, transfers, retention and agent consent |
| [Calendar quotas](https://developers.google.com/workspace/calendar/api/guides/quota) | Current quota figures and pricing caveat |
| [Workspace tiering](https://developers.google.com/workspace/tools-safety) | Planned billing model including MCP |
