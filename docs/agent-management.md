# Agent Management

Agents are the core execution unit in Nexus Live. Every conversation is assigned to an agent. Agents have a type (AI or Human), a role, a behavior profile, and a status.

---

## Nexus Live Console

The desk-facing conversation monitor at `/nexus-live-console`.

### Mode Detection

On `init()`, calls `agent_console.get_agent_context`. If `is_agent=true` the console enters **agent mode**: an agent banner shows the signed-in agent's nickname and assigned categories, with the text "Showing all active external conversations". Otherwise, **admin mode** is used.

The full status dropdown is available in both modes (default: "All Statuses"). The status filter is no longer locked to "Escalated" in agent mode.

Agent mode is determined by: active `Nexus User Profile Assignment` with `can_handle_escalations=1` AND NOT `System Manager`.

### Key Behaviors

- Loads active conversations via `get_active_conversations` — all statuses (Open, Responding, Escalated, Waiting) for all users; agent mode no longer restricts by category
- Opens a conversation → calls `frappe.realtime.task_subscribe(conversation_id)` to join the conversation's Socket.IO task room, then loads the full message thread via `get_conversation_detail`; `task_unsubscribe(conversation_id)` is called when the panel closes
- `publish_chat_response` publishes to `task_id=conversation_id`; without subscribing, the console would never receive `nexus_chat_response` events for that conversation
- Subscribes to `nexus_escalation_alert` (new escalation arrives) and `nexus_escalation_claimed` (agent claimed a conversation) globally
- Panel receives `nexus_chat_response` for that conversation — `response_type="visitor_message"` (visitor replies) and `sender_type="Human Agent"` messages (agent replies)
- Auto-refreshes the conversation list every 15 seconds
- Clicking a conversation card opens the **conversation panel** (full-screen right drawer) — never the corner chat bubble
- On panel open: `#nep-history` auto-scrolls to the bottom so the latest message is immediately visible
- New messages appended via realtime get a brief blue glow flash on the bubble
- Cards with new unread visitor messages blink continuously (red border pulse, `animation: infinite`) until the desk user opens that conversation; blink is suppressed for the conversation currently open in the panel
- Blink state (`_pending_attention` Set) persists across 15-second poll re-renders

### Claim section in the conversation panel

| Situation | UI |
|---|---|
| Unclaimed + agent mode | "Take this conversation" button |
| Claimed by self | "You are handling this conversation" |
| Claimed by other | "Taken by [nickname]"; input disabled |
| System Manager | No claim needed; input always enabled |

### `agent_send_message` — sender fields

`agent_send_message` sets `sender_type = "Human Agent"` on the `Nexus Live Message` record. The `sender_agent` field (Link to `Nexus AI Agent Profile`) is left **blank** for human agent messages — it is for AI bot records only. Human agent identity is tracked via `conversation.human_agent` (Frappe user ID).

---

## Agent Types

### AI Agent

Handles conversations automatically using the Nexus Core answer pipeline. The agent's behavior profile controls tone, response style, confidence threshold, and escalation trigger. When confidence drops below the threshold, the AI agent triggers escalation to a human.

### Human Agent

Receives conversations escalated from AI agents or directly assigned through queues. Human agents have a profile for display and routing purposes but do not generate AI responses.

---

## Agent Roles

`agent_role` on `Nexus AI Agent Profile` serves three distinct purposes:

**1. Keyword-based routing fallback** — when no explicit agent is requested and the channel
default is not set, the router infers a role from query keywords and selects a matching profile.

**2. Escalation rule matching** — `Nexus Escalation Rule.agent_role` links a rule to profiles
with the same role. Only rules whose `agent_role` matches the active profile's role fire.

**3. AI core context forwarding** — `agent_role` is included in the `core_payload` sent to
`digitz_ai_nexus` so the answer pipeline can tailor retrieval and generation behaviour per role.

| Role | Primary Use Case |
|---|---|
| Public Responder | General public Q&A, default for anonymous visitors |
| Sales | Pricing, product discovery, commercial queries |
| Support | Error resolution, troubleshooting, technical support |
| Consultant | Advisory and high-complexity queries |
| Internal Assistant | Internal staff queries (desk, portal) |
| Admin Reviewer | Administrative and governance queries |

Role detection during routing uses keyword inference from the query text (e.g. "price" → Sales,
"error" → Support). An explicit `requested_agent` in the payload bypasses role inference.

---

## Behavior Profiles

`Nexus AI Agent Profile` is a **reusable template** that controls **how** the AI responds —
persona, tone, style, fallback messages, escalation settings, and confidence thresholds.
It does **not** control knowledge access.

Knowledge access is owned by `Nexus Identity Profile` via the person's `Nexus Identity Registry`
entry. See [knowledge-access-architecture.md](knowledge-access-architecture.md) for the full chain.

At conversation start, a `Nexus AI Agent Profile Instance` is created from the template.
The instance holds a randomly-assigned nickname (visible in the chat widget header) and is
linked to the conversation for the duration of the session.

Resolution priority for category-based routing:
1. `Nexus Category Identity Route` → `ai_agent_profile` — profile resolved by channel + category
2. `agent_role` fallback — keyword-based routing selects a profile matching the inferred role
3. Channel `default_agent` — fallback when no role match is found

### Nexus AI Agent Profile Fields

| Field | Purpose |
|---|---|
| `agent_code` | Unique identifier; used in routing, logs, and autoname |
| `agent_name` | Internal display name |
| `display_name` | Visitor-facing name used when no nickname pool is set |
| `nickname_pool` | One name per line. A random name is picked each session. Priority: pool → display_name → built-in 25-name default pool |
| `agent_role` | Role used for (1) keyword-based routing fallback, (2) escalation rule matching, (3) AI core context forwarding |
| `behavior_prompt` | Main behavioural instruction for this profile |
| `tone` | Free text style hint, e.g. Professional, Friendly, Technical |
| `response_style` | Free text response structure hint, e.g. Concise, Balanced, Detailed |
| `welcome_message` | Optional initial message for a new conversation |
| `fallback_message` | Response when approved knowledge is insufficient |
| `do_not_answer_rules` | Topics this profile must not address |
| `default_response_mode` | qa or chat |
| `confidence_threshold` | Below this score, escalation is triggered |
| `escalation_enabled` | Whether this profile may trigger escalation |
| `escalation_policy` | Link to Nexus Escalation Rule |
| `memory_mode` | None / Session / Conversation Summary / Long Term |
| `system_notes` | Internal admin notes |

### Nexus AI Agent Profile Instance

Each conversation creates one `Nexus AI Agent Profile Instance` from the template. The instance
carries the session nickname and is closed when the conversation ends.

| Field | Purpose |
|---|---|
| `profile_template` | Link to the source `Nexus AI Agent Profile` |
| `nickname` | Randomly chosen at conversation start; shown in the chat widget header |
| `conversation` | Link to `Nexus Live Conversation` |
| `status` | Active (in-flight) / Closed (when conversation ends) |
| `created_on` | Datetime |

The nickname is chosen once during `create_conversation()`, stored in both the instance and the
`ai_profile_snapshot_json` on the conversation. Follow-up messages restore from the snapshot
so the same nickname persists throughout the session regardless of pool changes.

### Nickname Selection

```
_pick_nickname(profile)
    1. profile.nickname_pool (one name per line) → random.choice(names)
    2. profile.display_name (non-empty fallback)
    3. Built-in 25-name default pool:
       Aria, Nova, Zara, Lyra, Sage, Echo, Finn, Milo, Luca, Orion,
       Iris, Jade, Remi, Skye, Taya, Ezra, Cleo, Demi, Halo, Juno,
       Kira, Lena, Noel, Pax, Vera
```

### Agent Persona and Nickname

The `nickname_pool` field on `Nexus AI Agent Profile` holds one name per line. Each conversation gets one name picked at random from the pool for that session — giving public visitors a varied persona experience across conversations.

**Priority chain in `_pick_nickname(profile)`:**
1. `nickname_pool` — random name from the pool (if populated)
2. `display_name` — the profile's visitor-facing display name (non-empty fallback)
3. Built-in 25-name default pool — used when neither above is set

**Nickname freezing:**
The chosen nickname is stored in two places at `create_conversation()` time:
- `Nexus AI Agent Profile Instance.nickname` — the per-session instance record
- `ai_profile_snapshot_json` on `Nexus Live Conversation` — the frozen behavioral snapshot

`get_agent_nickname(conversation, agent)` always reads from `ai_profile_snapshot_json`, not from the live profile. This means the nickname is immutable for the duration of the conversation even if the profile's `nickname_pool` is changed by an admin mid-session.

**Where the nickname is surfaced:**
1. **Chat widget header title** — shows the agent's nickname when the chat opens
2. **Sender label above every AI bubble** — displayed in blue (`#2158c7`) above each AI message; populated via the `agent_name` field in every `nexus_chat_response` event for AI messages
3. **Initial greeting messages** — e.g. `"Hi! I'm {agent_nick}, your AI assistant. It's great to have you here!"`

**Profile-level guidance:**
- For **public visitors**: populate `nickname_pool` with persona names to give each conversation a distinct identity. If left empty, `display_name` is used; if that is also empty, a name is drawn from the built-in pool.
- For **desk users**: `display_name` is the typical fallback — there is no need to populate a nickname pool for internal profiles unless persona variety is desired.

---

## Agent Status

Agents cycle through these statuses:

```
Draft → Onboarding → Idle → Assigned → Responding → Waiting → Unavailable → Disabled
```

| Status | Meaning |
|---|---|
| Draft | Configured but not yet active |
| Onboarding | Pending approval via Nexus Agent Onboarding |
| Idle | Active, no current session |
| Assigned | Assigned to one or more conversations |
| Responding | Currently generating or delivering a response |
| Waiting | Waiting for user reply |
| Unavailable | Temporarily offline |
| Disabled | Permanently inactive, excluded from routing |

`agent_service.is_agent_available(agent)` returns `True` only for agents in `Idle` or `Assigned` status with `current_active_sessions < max_active_sessions`.

---

## Profile Resolution

Profile resolution is the step that determines which `Nexus AI Agent Profile` governs a
conversation. It happens before any query is sent to Nexus Core.

### External users (chat window)

The user selects a `Nexus Chat Category`. Runtime resolves a `Nexus Category Identity Route`:

```
channel + chat_category → Nexus AI Agent Profile (behavior)
                        → permitted Identity Profiles (knowledge access)
```

Public visitors: route where `open_to_all = not bool(identity_profiles)` → `force_public_only = True` →
`allowed_access_policies = ["Public"]`. This bypass applies even when a named profile is
configured on the route — the identity type cap always wins for Public.

Registered visitors: visitor's Identity Registry profiles intersected with route's permitted
profiles → collect Knowledge Profiles for matching identity_type → union policies.

### Internal / desk users

Knowledge access for desk users is resolved via `Nexus Identity Registry`:

```
frappe.session.user → Nexus Identity Registry (registry.user)
    → assigned Identity Profiles
    → identity_mappings where identity_type = "Internal" | "Admin"
    → knowledge_profile_names
```

If no registry entry exists, the user is denied unless they are a `System Manager`
(who receives all enabled policies unconditionally).

`Nexus User Profile Assignment` is **only for escalation configuration** (whether the user
can handle escalated conversations and for which categories). It is not used for knowledge access.

### API / non-chat channels

Direct integrations should pass explicit knowledge_profile_names in the payload or rely on the
channel's configured agent path.

### Knowledge access handoff

Before calling Nexus Core, Live builds the `ai_profile` dict including `knowledge_profile_names`:

```
ai_profile = {
    "name": "PUBLIC-AI-ASSISTANT",         # profile template name
    "knowledge_profile_names": ["...", "..."],  # knowledge access
    ...
}
→ resolve_allowed_policies({ai_profile: ai_profile})
→ allowed_access_policies
→ call retrieval / answer service
```

If `knowledge_profile_names` is empty and no System Manager session, `allowed_access_policies = []`
and retrieval fails closed (except for Public identity type, which always returns `["Public"]`).

## Agent Routing

`agent_router.assign_agent(payload)` selects an agent for each conversation. The selection logic:

1. **Explicit request** — if `payload.requested_agent` is set, use that agent (if available).
2. **Channel default** — if the channel has a `default_agent`, use it.
3. **Role inference** — detect required role from query keywords, then find an available agent with that role.
4. **Fallback** — use any available Public Responder agent.

Role detection keyword map (simplified):

| Keywords | Inferred Role |
|---|---|
| price, cost, pricing, buy, purchase | Sales |
| error, issue, bug, broken, not working | Support |
| consult, advise, recommend, strategy | Consultant |
| internal, staff, employee | Internal Assistant |
| admin, configure, setup, governance | Admin Reviewer |
| (none matched) | Public Responder |

---

## Session Tracking

`agent_service` tracks how many sessions each agent is handling:

- `increment_active_sessions(agent)` — called when a conversation is assigned
- `decrement_active_sessions(agent)` — called when a conversation closes or escalates away
- `max_active_sessions` — configurable cap per agent; router skips agents at capacity

---

## Agent Onboarding

New agents go through an approval workflow before becoming active:

```
Agent created (Draft)
    │
    ▼
Nexus Agent Onboarding record created
    │
    ▼
Review and approval
    │
    ▼
Agent status → Idle (available for routing)
```

`Nexus Agent Onboarding` tracks the approval steps. Agents in `Onboarding` status are excluded from routing until approval completes.
