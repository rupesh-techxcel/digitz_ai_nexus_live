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
| behaviour | Link → Nexus AI Behaviour | Preferred behavior profile |
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

### Nexus AI Behaviour

Runtime behavior configuration for AI agents. Preferred over the legacy `Nexus AI Agent Profile`.

| Field | Type | Notes |
|---|---|---|
| behaviour_code | Data (unique) | |
| behaviour_name | Data | |
| designation | Data | Role label shown to visitors |
| behavior_prompt | Long Text | System prompt injected into LLM context |
| tone | Select | Professional / Consultative / Supportive / Technical / Friendly / Formal |
| response_style | Select | Balanced / Concise / Step-by-step / Detailed / Persuasive |
| memory_mode | Select | None / Session |
| confidence_threshold | Float | Escalation trigger threshold (default 0.65) |
| escalation_enabled | Check | Whether this behavior supports escalation |
| welcome_message | Small Text | Shown at conversation start |
| fallback_message | Small Text | Used when confidence is too low |
| do_not_answer_rules | Long Text | Topics the agent must refuse |

Autoname: `field:behaviour_code`.

---

### Nexus AI Agent Profile *(Legacy)*

Legacy AI behavior configuration. Used as fallback when no `Nexus AI Behaviour` is linked on the agent. New deployments should use `Nexus AI Behaviour` instead.

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

### Nexus AI Agent Profile Access Category *(Child Table)*

Maps an `Nexus AI Agent Profile` to an `Nexus Access Category`. Controls which knowledge policies the legacy profile can retrieve.

---

## nexus_live_conversations

### Nexus Live Conversation

Root document for a conversation session.

| Field | Type | Notes |
|---|---|---|
| conversation_id | Data (unique) | Client-facing identifier (e.g. NLCV-00001) |
| conversation_type | Select | Q&A / Chat |
| channel | Link → Nexus Live Channel | |
| visitor_name | Data | |
| visitor_email | Data | |
| visitor_phone | Data | |
| user_type | Select | Guest / Website User / Desk User |
| assigned_agent | Link → Nexus Live Agent | |
| assigned_agent_type | Select | AI / Human |
| status | Select | Open / Waiting / Responding / Escalated / Handed Over / Closed |
| intent | Data | Detected intent from first message |
| last_message | Small Text | Preview of the last user message |
| last_response | Small Text | Preview of the last AI response |
| confidence | Float | Last confidence score |
| escalation_status | Select | Pending / Assigned / Resolved |
| started_on | Datetime | |
| closed_on | Datetime | |

Autoname: `NLCV-.#####`. Conversation documents are never deleted; closed conversations are retained for audit.

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

### Nexus Channel AI Profile Route *(Legacy)*

Maps a channel to a legacy AI profile for routing. Superseded by `Nexus Channel Routing Rule`.

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

## nexus_live_experience

### Nexus Live Experience

Experience bundle — a named deployment configuration grouping Q&A config, chat config, and branding.

| Field | Type | Notes |
|---|---|---|
| experience_code | Data (unique) | |
| experience_name | Data | |
| experience_type | Select | Public Website / Customer Portal / Internal Desk / Demo |
| default_qa_config | Link → Nexus Q And A Configuration | |
| default_chat_config | Link → Nexus Chat Configuration | |
| branding_json | Long Text | Brand color, logo, and layout overrides as JSON |
| enabled | Check | |

Autoname: `field:experience_code`.

---

### Nexus Chat Configuration

Chat-mode behavior and UI configuration.

| Field | Type | Notes |
|---|---|---|
| config_name | Data (unique) | |
| default_agent | Link → Nexus Live Agent | |
| channel | Link → Nexus Live Channel | |
| welcome_message | Small Text | |
| input_placeholder | Data | |
| show_agent_name | Check | |
| show_sources | Check | |
| enabled | Check | |

---

### Nexus Q And A Configuration

Q&A-mode behavior and UI configuration.

| Field | Type | Notes |
|---|---|---|
| config_name | Data (unique) | |
| default_agent | Link → Nexus Live Agent | |
| channel | Link → Nexus Live Channel | |
| welcome_message | Small Text | |
| show_sources | Check | |
| max_questions_per_session | Int | |
| enabled | Check | |

---

### Nexus Welcome Flow

Defines the initial greeting sequence shown to a visitor before their first message.

| Field | Type | Notes |
|---|---|---|
| flow_name | Data | |
| experience | Link → Nexus Live Experience | |
| welcome_text | Small Text | |
| show_suggested_prompts | Check | |
| enabled | Check | |

---

### Nexus Suggested Prompt

AI-suggested follow-up question shown to visitors.

| Field | Type | Notes |
|---|---|---|
| prompt_text | Data | The suggested question |
| experience | Link → Nexus Live Experience | |
| display_order | Int | |
| enabled | Check | |

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
