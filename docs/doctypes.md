# DocType Reference

All DocTypes in `digitz_ai_nexus_live`, grouped by module.

---

## nexus_live_agents

### Nexus Live Agent

Registry of all AI and human agents. Every conversation is assigned to an agent.

| Field | Type | Notes |
|---|---|---|
| `agent_code` | Data (unique) | Primary identifier used in routing and logs |
| `agent_name` | Data | Display name |
| `display_name` | Data | Visitor-facing name |
| `agent_type` | Select | AI / Human |
| `agent_role` | Select | Public Responder / Sales / Support / Consultant / Internal Assistant / Admin Reviewer |
| `status` | Select | Draft / Onboarding / Idle / Assigned / Responding / Waiting / Unavailable / Disabled |
| `enabled` | Check | Excluded from routing when disabled |
| `visibility` | Select | Public / Internal / Both |
| `business_unit` | Data | Scopes agent to a business unit |
| `default_channel` | Link → Nexus Live Channel | |
| `priority` | Int | Routing preference weight |
| `max_active_sessions` | Int | Session cap; router skips agents at capacity |
| `current_active_sessions` | Int | Live counter incremented/decremented by agent_service |
| `avatar` | Attach Image | |
| `last_active_on` | Datetime | |

Autoname: `field:agent_code`.

---

### Nexus AI Agent Profile

A reusable **template** that defines an AI agent's identity, persona, and behavior. At
conversation start the runtime creates a `Nexus AI Agent Profile Instance` from this template,
assigns it a randomly-picked nickname, and links it to the conversation.

**Does not control knowledge access** — knowledge access is owned by `Nexus Identity Profile`
via the person's Identity Registry.

| Field | Type | Notes |
|---|---|---|
| `agent_code` | Data (unique) | Primary identifier; used in routing and logs |
| `agent_name` | Data | Internal display name |
| `display_name` | Data | Visitor-facing fallback when no nickname pool is set |
| `nickname_pool` | Small Text | One name per line. A random name is picked each session. Falls back to `display_name`, then a built-in 25-name default pool. |
| `agent_role` | Select | Public Responder / Sales / Support / Consultant / Internal Assistant / Admin Reviewer. Used for (1) keyword-based routing, (2) escalation rule matching, (3) AI core context. |
| `visibility` | Select | Public / Internal / Both |
| `enabled` | Check | Excluded from routing when disabled |
| `status` | Select | Idle / Assigned / Disabled |
| `max_active_sessions` | Int | Session cap; router skips profiles at capacity |
| `current_active_sessions` | Int | Live counter incremented/decremented by agent_service |
| `priority` | Int | Routing preference weight |
| `default_channel` | Link → Nexus Live Channel | |
| `avatar` | Attach Image | |
| `behavior_prompt` | Long Text | Main behavioural instruction |
| `tone` | Data | e.g. Professional, Friendly, Technical |
| `response_style` | Data | e.g. Concise, Balanced, Detailed |
| `welcome_message` | Small Text | Shown at conversation start |
| `fallback_message` | Small Text | Used when approved knowledge is insufficient |
| `do_not_answer_rules` | Long Text | Topics this profile must not address |
| `default_response_mode` | Select | qa / chat |
| `confidence_threshold` | Float | Escalation trigger threshold (default 0.65) |
| `escalation_enabled` | Check | Whether this profile may trigger escalation |
| `escalation_policy` | Link → Nexus Escalation Rule | |
| `memory_mode` | Select | None / Session / Conversation Summary / Long Term |
| `intent_overrides` | Table → Nexus Profile Intent Override | Profile-level intent handler overrides |
| `system_notes` | Small Text | Internal admin notes |

Autoname: `field:agent_code`.

---

### Nexus AI Agent Profile Instance

A runtime snapshot of a `Nexus AI Agent Profile` created at conversation start. Carries the
randomly-assigned nickname shown in the chat widget header. Closed when the conversation ends.

| Field | Type | Notes |
|---|---|---|
| `profile_template` | Link → Nexus AI Agent Profile | The template this instance was created from |
| `nickname` | Data | Name picked at session start (from pool, display_name, or default pool) |
| `conversation` | Link → Nexus Live Conversation | |
| `status` | Select | Active / Closed |
| `created_on` | Datetime | |

Autoname: `NAAPI-.YYYY.-.#####`.

---

### Nexus Intent Handler

Global definitions of special-case intents. The LLM router checks user messages against these
before routing to knowledge retrieval.

| Field | Type | Notes |
|---|---|---|
| `intent_name` | Data (unique) | Document key and display name |
| `trigger_description` | Small Text | Natural-language description used by the LLM to match messages |
| `action_type` | Select | `escalate` or `predefined_answer` |
| `response_template` | Text | Response delivered when the intent matches |
| `priority` | Int | Lower number = evaluated first (default 10) |
| `enabled` | Check | |

Autoname: `field:intent_name`.

---

### Nexus Profile Intent Override

Child table on `Nexus AI Agent Profile`. Allows profiles to disable, replace, or change the
action of any global `Nexus Intent Handler` without affecting other profiles.

| Field | Type | Notes |
|---|---|---|
| `intent_handler` | Link → Nexus Intent Handler | |
| `disabled` | Check | Disable this handler for this profile |
| `override_action_type` | Select | Change action type for this profile only |
| `override_response` | Text | Replace global `response_template` |
| `decline_response` | Text | Message shown when intent is disabled |

`istable = 1`.

---

### Nexus User Profile Assignment

Assigns a Frappe desk user to an escalation configuration. This record grants the user
**human agent capabilities** in the live console (receiving escalation alerts, claiming
escalated conversations).

Knowledge access for desk users is configured through `Nexus Identity Registry`, not here.

| Field | Type | Notes |
|---|---|---|
| `user` | Link → User | Frappe desk user |
| `active` | Check | Only one active record per user |
| `assigned_by` | Link → User | Set automatically on insert |
| `assigned_on` | Datetime | Set automatically on insert |
| `can_handle_escalations` | Check | Allows this user to claim escalated conversations |
| `max_escalation_sessions` | Int | Max simultaneous escalated conversations |
| `escalation_categories` | Table → Nexus Chat Category Link | Which categories the user receives alerts for |
| `notes` | Small Text | Admin notes |

Autoname: `NUPA-.#####`. Only one active record per user is permitted.

---

## nexus_live_channels — Identity and Access

### Nexus Identity Type

Named identity class. The document name is the identity type value used throughout the system.

| Field | Type | Notes |
|---|---|---|
| `title` | Data (unique) | Human-readable identity class name and Link value |
| `enabled` | Check | Disabled types are hidden from routing |
| `sort_order` | Int | Display ordering |
| `description` | Small Text | |
| `safeguard_access_categories` | Table → Nexus Identity Type Safe Guard Category | Hard access cap for ALL holders of this identity class |

The safeguard is a class-level ceiling. All persons resolved as this identity type are capped
to the union of policies reachable from the configured categories — no per-person overrides.

Autoname: `field:title`.

---

### Nexus Identity Type Safe Guard Category

Child table under `Nexus Identity Type`. Each row adds one `Nexus Access Category` to the
safeguard cap for that identity class.

| Field | Type | Notes |
|---|---|---|
| `access_category` | Link → Nexus Access Category | |

---

### Nexus Identity Profile

A reusable bundle that maps identity types to Knowledge Profiles. One profile can be assigned
to many people via `Nexus Identity Registry`.

| Field | Type | Notes |
|---|---|---|
| `profile_name` | Data (unique) | Primary key |
| `title` | Data | Display label |
| `enabled` | Check | Excluded from resolution when disabled |
| `description` | Small Text | |
| `identity_mappings` | Table → Nexus Identity Profile Mapping | One row per (identity_type, knowledge_profile) pair |

Autoname: `field:profile_name`.

---

### Nexus Identity Profile Mapping

Child table under `Nexus Identity Profile`. Each row binds one identity type to one Knowledge Profile.

| Field | Type | Notes |
|---|---|---|
| `identity_type` | Link → Nexus Identity Type | Required |
| `knowledge_profile` | Link → Knowledge Profile | Required |

---

### Nexus Identity Registry

The individual person record for every visitor, desk user, or human agent that needs knowledge
access. Desk users are found via `registry.user`; registered visitors are found by email after
OTP verification.

| Field | Type | Notes |
|---|---|---|
| `email` | Data (unique) | Primary identifier |
| `full_name` | Data | |
| `user` | Link → User | Optional; for desk users and portal users |
| `enabled` | Check | Disabled registries are ignored |
| `verification_status` | Select | Unverified / Verified / Blocked |
| `verified_on` | Datetime | |
| `reference_doctype` / `reference_name` | Dynamic Link | Optional: Contact, Customer, etc. |
| `contact` | Link → Contact | Optional |
| `mobile_no` | Data | Optional phone identifier |
| `identity_profiles` | Table → Nexus Registry Identity Profile | Assigned Identity Profiles with validity dates |
| `notes` | Small Text | |

Autoname: `field:email`. Public visitors have no registry entry — they use the Public bypass path.

---

### Nexus Registry Identity Profile

Child table under `Nexus Identity Registry`. Each row assigns one `Nexus Identity Profile`
to the person, optionally scoped by date range and priority.

| Field | Type | Notes |
|---|---|---|
| `identity_profile` | Link → Nexus Identity Profile | Required |
| `is_primary` | Check | Primary profile used when no route-specific intersection yields a match |
| `valid_from` | Date | Optional start date |
| `valid_until` | Date | Optional expiry date |

---

### Nexus Identity Verification Challenge

Stores a short-lived email OTP challenge for chat categories that require email validation.

| Field | Type | Notes |
|---|---|---|
| `challenge_token` | Data (unique) | Token returned to the browser while OTP is pending |
| `status` | Select | Pending / Verified / Expired / Failed |
| `verification_mode` | Select | Email OTP / Registered Email OTP |
| `email` | Data | Email being verified |
| `channel` | Link → Nexus Live Channel | |
| `chat_category` | Link → Nexus Chat Category | |
| `otp_hash` | Data | Hashed OTP (raw OTP never stored) |
| `expires_on` | Datetime | |
| `attempts` / `max_attempts` | Int | |
| `verified_on` | Datetime | Set on successful OTP verification |
| `identity_registry` | Link → Nexus Identity Registry | Set when registry matched |
| `resolved_identity_type` | Link → Nexus Identity Type | Identity granted after OTP succeeds |

---

### Nexus Category Identity Route

Maps a chat category (and its implied channel) to an AI Agent Profile and a set of permitted
Identity Profiles. This is the primary route resolution mechanism for chat-window users.

**Two route types:**

| Type | `open_to_all` (derived) | Knowledge access |
|---|---|---|
| Public | `True` (no `identity_profiles` configured) | `allowed_access_policies = ["Public"]` only. No Identity Profile matching. |
| Registered | `False` (`identity_profiles` present) | Person's identity profiles intersected with route's permitted profiles |

`open_to_all` is derived at runtime as `not bool(identity_profiles)` — there is no stored field.

| Field | Type | Notes |
|---|---|---|
| `channel` | Link → Nexus Live Channel (read-only) | Derived from `chat_category.channel` via `fetch_from`. Cannot be set manually. |
| `chat_category` | Link → Nexus Chat Category | Required. The category owns the channel; selecting a category implies the channel. |
| `ai_agent_profile` | Link → Nexus AI Agent Profile | AI behavior config — not knowledge access |
| `enabled` | Check | |
| `published` | Check | When unchecked, route is inactive for identity-based routing without being deleted |
| `identity_profiles` | Table → Nexus Route Identity Profile | Permitted profiles for registered visitors |
| `priority` | Int | Lower number = higher priority when multiple routes match |
| `description` | Small Text | |

Autoname: `hash`.

---

### Nexus Route Identity Profile

Child table under `Nexus Category Identity Route`. Each row lists one permitted
`Nexus Identity Profile` for this route. At runtime, the visitor's assigned profiles are
intersected against this list.

| Field | Type | Notes |
|---|---|---|
| `identity_profile` | Link → Nexus Identity Profile | Required |

---

### Nexus Live Channel

Defines an entry point for conversations.

| Field | Type | Notes |
|---|---|---|
| `channel_code` | Data (unique) | |
| `channel_name` | Data | |
| `channel_type` | Select | Website Q&A / Website Chat / Desk / Portal / API / WhatsApp |
| `enabled` | Check | |
| `default_agent` | Link → Nexus Live Agent | Fallback when routing cannot find a role-matched agent |
| `public_access` | Check | Forces `force_public_only` on all queries through this channel |
| `requires_visitor_email` | Check | Enforces email collection before conversation starts |
| `agent_based` | Check | Whether agent routing logic applies |

Autoname: `field:channel_code`.

---

### Nexus Chat Category

Pre-defined options displayed in the chat window. A category declares user intent and owns
its channel. Selecting a category implies the channel. Profile resolution happens through
`Nexus Category Identity Route`.

| Field | Type | Notes |
|---|---|---|
| `category_code` | Data (unique) | |
| `category_label` | Data | What the user sees in the chat window |
| `channel` | Link → Nexus Live Channel (required) | The channel this category belongs to. One category → one channel. |
| `tenant` | Link → Nexus Tenant | |
| `enabled` | Check | |
| `published` | Check | When checked, category appears in the chat widget picker |
| `visibility` | Select | External / Internal / Both — controls which interface surfaces this category |
| `identity_verification_mode` | Select | None / Email OTP / Registered Email OTP |
| `allow_public_fallback` | Check | Allow unregistered OTP-verified emails to continue as Public |
| `display_order` | Int | Sort order in chat window |
| `description` | Small Text | |
| `enable_escalation` | Check | When enabled, AI can escalate conversations in this category to a human agent |
| `faq_questions` | Table → Nexus Chat Category FAQ | Pre-built FAQ quick questions shown to visitors |

---

### Nexus Website Widget

Configuration for an embeddable chat widget on external websites.

| Field | Type | Notes |
|---|---|---|
| `widget_name` | Data | |
| `channel` | Link → Nexus Live Channel | |
| `widget_type` | Select | Q&A / Chat |
| `title` | Data | Widget header text |
| `welcome_message` | Small Text | |
| `brand_color` | Color | |
| `launcher_icon` | Attach Image | |
| `enabled` | Check | |
| `embed_script` | Code | Auto-generated embed snippet |

---

## nexus_live_conversations

### Nexus Live Conversation

Root document for a conversation session.

| Field | Type | Notes |
|---|---|---|
| `conversation_id` | Data (unique) | Client-facing identifier |
| `conversation_type` | Select | Q&A / Chat |
| `channel` | Link → Nexus Live Channel | |
| `chat_category` | Link → Nexus Chat Category | Category selected at conversation start (read only) |
| `resolved_identity_type` | Link → Nexus Identity Type | Identity resolved during the opening handshake (read only) |
| `identity_registry` | Link → Nexus Identity Registry | Registry matched at conversation start |
| `visitor_name` / `visitor_email` / `visitor_phone` | Data | |
| `user_type` | Select | Guest / Website User / Desk User |
| `assigned_agent` | Link → Nexus Live Agent | |
| `assigned_agent_type` | Select | AI / Human |
| `assigned_ai_agent_profile` | Link → Nexus AI Agent Profile | Template profile resolved at conversation start (read only) |
| `agent_profile_instance` | Link → Nexus AI Agent Profile Instance | Runtime instance created for this conversation; carries the session nickname |
| `ai_profile_snapshot_json` | Code (JSON) | Frozen snapshot of profile behavior + `knowledge_profile_names` + `nickname` at conversation start |
| `identity_safeguard_access_json` | Code (JSON) | Frozen safeguard categories at conversation start |
| `status` | Select | Open / Waiting / Responding / Escalated / Handed Over / Closed |
| `intent` | Data | Detected intent from first message |
| `last_message` / `last_response` | Small Text | Previews |
| `confidence` | Float | Last confidence score |
| `escalation_status` | Select | None / Pending / Accepted / Resolved / Rejected |
| `started_on` / `closed_on` | Datetime | |

Autoname: `field:conversation_id`.

The `ai_profile_snapshot_json` freezes the full behavior configuration **including
`knowledge_profile_names`** at conversation creation. Follow-up messages restore the same
knowledge boundary from the snapshot — profile or Identity Profile changes mid-session do not
affect in-progress conversations.

---

### Nexus Live Message

Individual messages within a conversation.

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `sender_type` | Select | user / assistant / system |
| `message` | Long Text | |
| `confidence` | Float | For assistant messages |
| `sources` | Long Text | JSON list of source references |
| `sent_at` | Datetime | |

Autoname: `NLM-.#####`. Messages are append-only.

---

### Nexus Conversation Participant

Tracks parties in a multi-participant conversation (e.g. when a human agent joins).

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `participant_type` | Select | visitor / agent / system |
| `agent` | Link → Nexus Live Agent | |
| `joined_at` / `left_at` | Datetime | |

---

### Nexus Conversation Feedback

Visitor-submitted feedback on a conversation.

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `rating` | Select | 1-5 |
| `feedback_text` | Long Text | |
| `submitted_at` | Datetime | |

---

## nexus_live_escalations

### Nexus Escalation Rule

Defines escalation triggers and targets for a specific agent role.

| Field | Type | Notes |
|---|---|---|
| `rule_name` | Data | |
| `agent_role` | Select | Which agent role this rule governs |
| `minimum_confidence` | Float | Escalate if confidence < this (default 0.65) |
| `escalate_on_no_knowledge` | Check | |
| `escalate_on_human_request` | Check | |
| `target_queue` | Link → Nexus Agent Queue | |
| `target_agent` | Link → Nexus Live Agent | Overrides queue if set |
| `enabled` | Check | |

Autoname: `NER-.#####`.

---

### Nexus Agent Queue

Named group of human agents available to receive escalated conversations.

| Field | Type | Notes |
|---|---|---|
| `queue_name` | Data (unique) | |
| `queue_description` | Small Text | |
| `enabled` | Check | |

Autoname: `field:queue_name`.

---

### Nexus Queue Assignment

Maps an agent to a queue. One agent may be in multiple queues.

| Field | Type | Notes |
|---|---|---|
| `queue` | Link → Nexus Agent Queue | |
| `agent` | Link → Nexus Live Agent | |
| `priority` | Int | Pick order within the queue |
| `enabled` | Check | |

Autoname: `NQA-.#####`.

---

## nexus_live_analytics

### Nexus Live Interaction Log

Detailed trace of every query/response exchange.

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `agent` | Link → Nexus Live Agent | |
| `channel` | Link → Nexus Live Channel | |
| `query` | Long Text | |
| `answer` | Long Text | |
| `confidence` | Float | |
| `escalated` | Check | |
| `fallback_used` | Check | |
| `response_time_ms` | Int | |
| `logged_at` | Datetime | |

Autoname: `NLIL-.#####`.

---

### Nexus Conversation Outcome

Summarizes the final outcome of a conversation.

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `outcome_type` | Select | Resolved / Escalated / Abandoned / No Response |
| `resolution_notes` | Small Text | |
| `recorded_at` | Datetime | |

---

### Nexus Lead Capture

Stores visitor contact information extracted from conversations.

| Field | Type | Notes |
|---|---|---|
| `conversation` | Link → Nexus Live Conversation | |
| `visitor_name` | Data | |
| `visitor_email` | Data | |
| `visitor_phone` | Data | |
| `intent` | Data | |
| `captured_at` | Datetime | |

---

### Nexus Agent Performance Snapshot

Periodic snapshot of an agent's performance metrics.

| Field | Type | Notes |
|---|---|---|
| `agent` | Link → Nexus Live Agent | |
| `snapshot_date` | Date | |
| `total_conversations` | Int | |
| `escalations` | Int | |
| `avg_confidence` | Float | |
| `avg_response_time_ms` | Int | |
| `fallback_rate` | Float | |

---

## nexus_live_admin

### Nexus Live Console *(Single)*

Live operations dashboard. Provides real-time visibility into active conversations, agent
availability, and escalation queue depth.

### Nexus Live Studio *(Single)*

Live chat configuration hub. Shows an overall readiness score (0–100) across five sections
— Channels & Categories, AI Agent Profiles, Routes & Access, Identity & Access Profiles, and
Human Escalation. Each section displays per-item checks, issue lists, and action buttons.
Score thresholds: ≥90 = Ready, ≥60 = Warning, <60 = Incomplete.
