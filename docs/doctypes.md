# DocType Reference

All DocTypes in `digitz_ai_nexus_live`, grouped by module.

---

## nexus_live_agents

### Nexus Live Agent

Registry of all AI and human agents. Every conversation is assigned to an agent.

| Field | Type | Notes |
|---|---|---|
| agent_code | Data (unique) | Primary identifier used in routing and logs |
| agent_name | Data | Display name |
| display_name | Data | Visitor-facing name |
| agent_type | Select | AI / Human |
| agent_role | Select | Public Responder / Sales / Support / Consultant / Internal Assistant / Admin Reviewer |
| status | Select | Draft / Onboarding / Idle / Assigned / Responding / Waiting / Unavailable / Disabled |
| enabled | Check | Excluded from routing when disabled |
| visibility | Select | Public / Internal / Both |
| business_unit | Data | Scopes agent to a business unit |
| default_channel | Link → Nexus Live Channel | |
| priority | Int | Routing preference weight |
| max_active_sessions | Int | Session cap; router skips agents at capacity |
| current_active_sessions | Int | Live counter incremented/decremented by agent_service |
| avatar | Attach Image | |
| last_active_on | Datetime | |

Autoname: `field:agent_code`. Routing excludes agents where `enabled = 0` or `status = Disabled`.

---

### Nexus AI Agent Profile

Primary runtime configuration for an AI agent. Owns both behaviour and access governance. One profile per agent (enforced via unique constraint on `agent` field).

| Field | Type | Notes |
|---|---|---|
| agent | Link → Nexus Live Agent (unique) | One profile per agent |
| behavior_prompt | Long Text | Main behavioural instruction |
| tone | Data | Free text, e.g. Professional, Friendly, Technical |
| response_style | Data | Free text, e.g. Concise, Balanced, Detailed |
| welcome_message | Small Text | Shown at conversation start |
| fallback_message | Small Text | Used when approved knowledge is insufficient |
| do_not_answer_rules | Long Text | Topics this profile must not address |
| default_response_mode | Select | qa / chat |
| confidence_threshold | Float | Escalation trigger threshold (default 0.65) |
| escalation_enabled | Check | Whether this profile may trigger escalation |
| escalation_policy | Link → Nexus Escalation Rule | |
| memory_mode | Select | None / Session / Conversation Summary / Long Term |
| intent_overrides | Table → Nexus Profile Intent Override | Profile-level overrides for global intent handlers |
| system_notes | Small Text | Internal admin notes |

Autoname: `hash`. Access categories are configured via `Nexus AI Agent Profile Access Category`. Intent handler overrides are configured via the `Intent Handlers` section on the profile form.

---

### Nexus Intent Handler

Global definitions of special-case intents. The LLM router checks user messages against these handlers before routing to knowledge retrieval. Applies to all agent profiles unless overridden.

| Field | Type | Notes |
|---|---|---|
| intent_name | Data (unique) | Human-readable name; also the document key |
| trigger_description | Small Text | Natural-language description of when this intent should fire. The LLM uses this to match user messages. |
| action_type | Select | `escalate` — connect user to human agent; `predefined_answer` — return a fixed response |
| response_template | Text | The response delivered when this intent is matched. Required for `predefined_answer`. |
| priority | Int | Lower number = evaluated first (default 10) |
| enabled | Check | Whether this handler is active |

Autoname: `field:intent_name`. See [intent-handlers.md](intent-handlers.md) for full reference.

---

### Nexus Profile Intent Override

Child table on `Nexus AI Agent Profile`. Allows profiles to disable, replace, or change the action of any global `Nexus Intent Handler` without affecting other profiles.

| Field | Type | Notes |
|---|---|---|
| intent_handler | Link → Nexus Intent Handler | Which global handler to override |
| disabled | Check | Disable this handler for this profile |
| override_action_type | Select | Change the action type for this profile only |
| override_response | Text | Replace the global `response_template` for this profile |
| decline_response | Text | Message shown when the intent is disabled (`disabled = True`) |

`istable = 1`. Not directly accessible from the DocType list — managed through the `Nexus AI Agent Profile` form.

---

### Nexus AI Behaviour *(Deprecated)*

Deprecated behaviour master retained only until the DocType can be removed safely from the app. Runtime behaviour is owned by `Nexus AI Agent Profile`; `Nexus Live Agent` no longer links to `Nexus AI Behaviour`.

New deployments should configure all behaviour fields on `Nexus AI Agent Profile`.

---

### Nexus Human Agent Profile

Human agent configuration record. Stores contact details and availability preferences.

---

### Nexus Agent Onboarding

Tracks the approval workflow for new agents.

| Field | Type | Notes |
|---|---|---|
| agent | Link → Nexus Live Agent | |
| submitted_by | Link → User | |
| submitted_on | Datetime | |
| reviewed_by | Link → User | |
| reviewed_on | Datetime | |
| status | Select | Pending / Approved / Rejected |
| notes | Long Text | Reviewer comments |

Agents remain in `Onboarding` status and are excluded from routing until this record is approved.

---

### Nexus Agent Activity Log

Records agent status changes and session events. Used for activity tracking and performance analysis.

---

### Nexus AI Agent Profile Access Category

Maps a `Nexus AI Agent Profile` to a `Nexus Access Category`. The sole runtime access mapping — determines which knowledge policies the profile may retrieve.

One AI Agent Profile can have multiple enabled access category rows. At runtime the profile receives the union of policies from every enabled category assigned to it.

| Field | Type | Notes |
|---|---|---|
| ai_agent_profile | Link → Nexus AI Agent Profile | |
| access_category | Link → Nexus Access Category | |
| enabled | Check | Excluded from resolution when disabled |
| priority | Int | Ordering |

Managed via the **Nexus Profile Access Allocation** page (`/nexus-profile-access-allocation`).

---

### Nexus User Profile Assignment

Direct assignment of an AI Agent Profile to a specific internal desk user. The normal profile resolution mechanism for internal users.

| Field | Type | Notes |
|---|---|---|
| user | Link → User | Frappe desk user |
| ai_agent_profile | Link → Nexus AI Agent Profile | The assigned profile |
| active | Check | Only one active record per user used at runtime |
| assigned_by | Link → User | Set automatically on insert |
| assigned_on | Datetime | Set automatically on insert |
| notes | Small Text | Admin notes |

Autoname: `NUPA-.#####`. Enforces one active assignment per user. Managed via the **Nexus User Profile Manager** page (`/app/nexus-user-profile-manager`) or the standard Frappe list/form. `System Manager` sessions may bypass the assignment requirement for admin/test use, but profile assignment remains the preferred way to control behavior.

---

## nexus_live_conversations

### Nexus Live Conversation

Root document for a conversation session.

| Field | Type | Notes |
|---|---|---|
| conversation_id | Data (unique) | Client-facing identifier |
| conversation_type | Select | Q&A / Chat |
| channel | Link → Nexus Live Channel | |
| chat_category | Link → Nexus Chat Category | Category selected at conversation start (read only) |
| resolved_identity_type | Link → Nexus Identity Type | Identity resolved during the opening handshake (read only) |
| route_access_category | Link → Nexus Access Category | Route access ceiling active at conversation start (read only) |
| visitor_name | Data | |
| visitor_email | Data | |
| visitor_phone | Data | |
| user_type | Select | Guest / Website User / Desk User |
| assigned_agent | Link → Nexus Live Agent | |
| assigned_agent_type | Select | AI / Human |
| assigned_ai_agent_profile | Link → Nexus AI Agent Profile | Profile active at conversation start (read only) |
| ai_profile_snapshot_json | Code (JSON) | Serialised profile behaviour snapshot at conversation start (read only) |
| status | Select | Open / Waiting / Responding / Escalated / Handed Over / Closed |
| intent | Data | Detected intent from first message |
| last_message | Small Text | Preview of the last user message |
| last_response | Small Text | Preview of the last AI response |
| confidence | Float | Last confidence score |
| escalation_status | Select | None / Pending / Accepted / Resolved / Rejected |
| started_on | Datetime | |
| closed_on | Datetime | |

Autoname: `field:conversation_id`. The profile snapshot preserves the resolved profile behaviour at conversation creation — profile changes after that point do not affect in-progress conversations. Conversation documents are never deleted.

---

### Nexus Live Message

Individual messages within a conversation.

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| sender_type | Select | user / assistant / system |
| message | Long Text | |
| confidence | Float | For assistant messages |
| sources | Long Text | JSON list of source references |
| sent_at | Datetime | |

Autoname: `NLM-.#####`. Messages are append-only — never modified after creation.

---

### Nexus Conversation Participant

Tracks parties in a multi-participant conversation (useful when a human agent joins an escalated chat).

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| participant_type | Select | visitor / agent / system |
| agent | Link → Nexus Live Agent | |
| joined_at | Datetime | |
| left_at | Datetime | |

---

### Nexus Conversation Feedback

Visitor-submitted feedback on a conversation.

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| rating | Select | 1-5 |
| feedback_text | Long Text | |
| submitted_at | Datetime | |

---

## nexus_live_channels

### Nexus Live Channel

Defines an entry point for conversations.

| Field | Type | Notes |
|---|---|---|
| channel_code | Data (unique) | |
| channel_name | Data | Display name |
| channel_type | Select | Website Q&A / Website Chat / Desk / Portal / API / WhatsApp |
| enabled | Check | |
| default_agent | Link → Nexus Live Agent | Used when routing cannot find a role-matched agent |
| public_access | Check | Forces `force_public_only` on all queries through this channel |
| requires_visitor_email | Check | Enforces email collection before conversation starts |
| agent_based | Check | Whether agent routing logic applies; if False, queries use a simple profile lookup |

Autoname: `field:channel_code`.

---

### Nexus Channel Routing Rule

Dynamic routing configuration for a channel. Matches query patterns to specific agents.

| Field | Type | Notes |
|---|---|---|
| channel | Link → Nexus Live Channel | |
| rule_name | Data | |
| match_keywords | Small Text | Comma-separated keywords that trigger this rule |
| target_agent | Link → Nexus Live Agent | |
| priority | Int | Higher priority rules are checked first |
| enabled | Check | |

---

### Nexus Chat Category

Pre-defined options displayed in the chat window. A category declares the user's intent; it does not directly grant access and does not directly store the AI profile. Profile resolution happens through `Nexus Category Identity Route`.

| Field | Type | Notes |
|---|---|---|
| category_code | Data (unique) | |
| category_label | Data | What the user sees in the chat window |
| channel | Link → Nexus Live Channel | Which channel this category appears on |
| requires_authentication | Check | Hide from guests when enabled |
| identity_verification_mode | Select | None, Email OTP, or Registered Email OTP |
| allow_public_fallback | Check | For Registered Email OTP, allow unregistered verified emails to continue as Public |
| display_order | Int | Sort order in chat window |
| enabled | Check | Controls visibility |
| description | Small Text | |

A category must have at least one enabled identity route for the resolved identity type before a conversation can start.

---

### Nexus Identity Type

Configurable visitor identity used by category/profile routing. The document name and display value are both the `title`; there is no separate code or label field.

| Field | Type | Notes |
|---|---|---|
| title | Data (unique) | Human-readable identity name and Link value |
| enabled | Check | Disabled identities are hidden from route allocation |
| sort_order | Int | Display order in route allocation pages |
| description | Small Text | |

Autoname: `field:title`.

---

### Nexus Identity Registry

Formal registry for the real person or party joining chat. The registry is looked up by session user or email before fallback identity resolution.

| Field | Type | Notes |
|---|---|---|
| email | Data (unique) | Primary verified email used for chat identity lookup |
| full_name | Data | Human-readable person or party name |
| enabled | Check | Disabled registries are ignored |
| verification_status | Select | Unverified, Verified, or Blocked |
| verified_on | Datetime | Set when the registry becomes Verified |
| user | Link → User | Optional authenticated portal/desk user |
| reference_doctype | Link → DocType | Optional business record type, such as Contact, Lead, Member, Customer if installed, or a custom DocType |
| reference_name | Dynamic Link | Optional linked business record |
| reference_label | Data | Optional readable external/reference label |
| contact | Link → Contact | Optional contact relationship |
| mobile_no | Data | Optional phone identifier |
| safe_guard_access_categories | Table MultiSelect → Nexus Identity Safe Guard Access Category | Parent-level maximum access categories allowed for this verified person |
| identities | Table → Nexus Registered Identity | One or more identity rows |
| notes | Small Text | |

Autoname: `field:email`.

### Nexus Registered Identity

Child table under `Nexus Identity Registry`. Each row grants one identity type to the registered person or party.

| Field | Type | Notes |
|---|---|---|
| identity_type | Link → Nexus Identity Type | Identity this person may resolve as |
| enabled | Check | Disabled rows are ignored |
| is_primary | Check | Fallback identity when no category-specific route matches |
| valid_from, valid_until | Date | Optional validity window |
| reference_doctype | Link → DocType | Optional source record type |
| reference_name | Dynamic Link | Optional source record |
| notes | Small Text | |

Only one enabled row should be marked primary per registry. A registry can hold multiple identity rows, such as Customer plus Partner.

---

### Nexus Identity Safe Guard Access Category

Table MultiSelect child under the parent `Nexus Identity Registry` Safe Guard section. It stores the maximum access categories this verified person may use during chat.

| Field | Type | Notes |
|---|---|---|
| access_category | Link → Nexus Access Category | Allowed safeguard category |

Runtime access for a registered identity is the intersection of profile access categories and these safeguard categories.

---

### Nexus Identity Verification Challenge

Stores a short-lived email OTP challenge for chat categories that require email validation.

| Field | Type | Notes |
|---|---|---|
| challenge_token | Data (unique) | Token returned to the browser while OTP is pending |
| status | Select | Pending, Verified, Expired, or Failed |
| verification_mode | Select | Email OTP or Registered Email OTP |
| email | Data | Email being verified |
| channel | Link → Nexus Live Channel | Channel used for the challenge |
| chat_category | Link → Nexus Chat Category | Category being verified |
| otp_hash | Data | Hashed OTP; raw OTP is never stored |
| expires_on | Datetime | Expiry timestamp |
| attempts, max_attempts | Int | Attempt control |
| verified_on | Datetime | Set on successful OTP verification |
| identity_registry | Link → Nexus Identity Registry | Set when registry matched |
| resolved_identity_type | Link → Nexus Identity Type | Identity granted after OTP succeeds |

---

### Nexus Category Identity Route

Maps a channel + chat category + identity type to an AI Agent Profile and an access ceiling. This is the primary profile resolution mechanism for chat-window users.

| Field | Type | Notes |
|---|---|---|
| channel | Link → Nexus Live Channel | |
| chat_category | Link → Nexus Chat Category | |
| identity_type | Link → Nexus Identity Type | Visitor identity served by this route |
| ai_agent_profile | Link → Nexus AI Agent Profile | Profile resolved for this category and identity |
| access_category | Link → Nexus Access Category | **Access Ceiling** — final retrieval policies are profile policies intersected with this category's policies. Optional; when absent, only the identity hard cap applies. |
| enabled | Check | Disabled routes are ignored |
| priority | Int | Lower number wins if multiple routes match |
| description | Small Text | |

The route access ceiling is a safety boundary. A `Public` identity is always hard-capped to the `Public` policy regardless of the ceiling setting. For all other identities the ceiling is the only cap, so it should be set explicitly for each route.

---

### Nexus Website Widget

Configuration for an embeddable chat widget on external websites.

| Field | Type | Notes |
|---|---|---|
| widget_name | Data | |
| channel | Link → Nexus Live Channel | |
| widget_type | Select | Q&A / Chat |
| title | Data | Widget header text |
| welcome_message | Small Text | |
| brand_color | Color | |
| launcher_icon | Attach Image | |
| enabled | Check | |
| embed_script | Code | Auto-generated embed snippet |

---

## nexus_live_escalations

### Nexus Escalation Rule

Defines escalation triggers and targets for a specific agent role.

| Field | Type | Notes |
|---|---|---|
| rule_name | Data | |
| agent_role | Select | Which agent role this rule governs |
| minimum_confidence | Float | Default 0.65; escalate if confidence < this |
| escalate_on_no_knowledge | Check | Escalate if retrieval finds nothing |
| escalate_on_human_request | Check | Escalate if user requests a human |
| target_queue | Link → Nexus Agent Queue | Human agent pool for escalation |
| target_agent | Link → Nexus Live Agent | Direct agent assignment; overrides queue if set |
| rule_conditions_json | Long Text | JSON for custom escalation conditions |
| enabled | Check | |

Autoname: `NER-.#####`.

---

### Nexus Agent Queue

Named group of human agents available to receive escalated conversations.

| Field | Type | Notes |
|---|---|---|
| queue_name | Data (unique) | |
| queue_description | Small Text | |
| enabled | Check | |

Autoname: `field:queue_name`.

---

### Nexus Queue Assignment

Maps an agent to a queue. One agent may be in multiple queues.

| Field | Type | Notes |
|---|---|---|
| queue | Link → Nexus Agent Queue | |
| agent | Link → Nexus Live Agent | |
| priority | Int | Determines pick order within the queue |
| enabled | Check | |

Autoname: `NQA-.#####`.

---

## nexus_live_analytics

### Nexus Live Interaction Log

Detailed trace of every query/response exchange. Lower-level than `Nexus Query Log` in Nexus Core — captures Live-specific fields.

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| agent | Link → Nexus Live Agent | |
| channel | Link → Nexus Live Channel | |
| query | Long Text | |
| answer | Long Text | |
| confidence | Float | |
| escalated | Check | |
| fallback_used | Check | |
| response_time_ms | Int | |
| logged_at | Datetime | |

Autoname: `NLIL-.#####`.

---

### Nexus Conversation Outcome

Summarizes the final outcome of a conversation.

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| outcome_type | Select | Resolved / Escalated / Abandoned / No Response |
| resolution_notes | Small Text | |
| recorded_at | Datetime | |

---

### Nexus Lead Capture

Stores visitor contact information extracted from conversations.

| Field | Type | Notes |
|---|---|---|
| conversation | Link → Nexus Live Conversation | |
| visitor_name | Data | |
| visitor_email | Data | |
| visitor_phone | Data | |
| intent | Data | Detected visitor intent |
| captured_at | Datetime | |

---

### Nexus Agent Performance Snapshot

Periodic snapshot of an agent's performance metrics.

| Field | Type | Notes |
|---|---|---|
| agent | Link → Nexus Live Agent | |
| snapshot_date | Date | |
| total_conversations | Int | |
| escalations | Int | |
| avg_confidence | Float | |
| avg_response_time_ms | Int | |
| fallback_rate | Float | |

---

## nexus_live_admin

### Nexus Live Console *(Single)*

Live operations dashboard. Provides real-time visibility into active conversations, agent availability, and escalation queue depth.

### Nexus Live Studio *(Single)*

Configuration interface for agents, behaviors, channels, and escalation rules. Used by the admin team to set up and tune the live platform.
