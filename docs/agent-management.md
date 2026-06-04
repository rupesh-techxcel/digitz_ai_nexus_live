# Agent Management

Agents are the core execution unit in Nexus Live. Every conversation is assigned to an agent. Agents have a type (AI or Human), a role, a behavior profile, and a status.

---

## Agent Types

### AI Agent

Handles conversations automatically using the Nexus Core answer pipeline. The agent's behavior profile controls tone, response style, confidence threshold, and escalation trigger. When confidence drops below the threshold, the AI agent triggers escalation to a human.

### Human Agent

Receives conversations escalated from AI agents or directly assigned through queues. Human agents have a profile for display and routing purposes but do not generate AI responses.

---

## Agent Roles

Roles are used by the agent router to match query intent to the right agent:

| Role | Use Case |
|---|---|
| Public Responder | General public Q&A, default for anonymous visitors |
| Sales | Pricing, product discovery, commercial queries |
| Support | Error resolution, troubleshooting, technical support |
| Consultant | Advisory and high-complexity queries |
| Internal Assistant | Internal staff queries (desk, portal) |
| Admin Reviewer | Administrative and governance queries |

Role detection during routing uses keyword inference from the query text (e.g. "price" → Sales, "error" → Support). An explicit `requested_agent` in the payload bypasses role inference.

---

## Behavior Profiles

Behavior and access are both owned by `Nexus AI Agent Profile`. This is the primary runtime object — it is resolved at query time and passed as `ai_profile` in the query payload to Nexus Core.

`Nexus Live Agent` does not own behaviour. It is the operational worker record: code, name, type, role, status, visibility, channel, and session limits.

Resolution priority in `agent_service.get_agent_behavior()`:
1. `Nexus AI Agent Profile` linked to the agent — **only runtime source in the non-category agent path**
2. Category-routed chats use the profile resolved by `Nexus Category Identity Route`

### Nexus AI Agent Profile Fields

| Field | Purpose |
|---|---|
| `agent` | Link to Nexus Live Agent (unique — one profile per agent) |
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

Profile resolution is the step that determines which `Nexus AI Agent Profile` governs a conversation. It happens before agent assignment and before any query is sent to Nexus Core.

### External users (chat window)

The user selects a `Nexus Chat Category` from the chat window (e.g. "Customer Support", "Product Enquiry", "Connect to Sales"). Runtime derives an `identity_type` and resolves `Nexus Category Identity Route`:

```
channel + chat_category + identity_type → Nexus AI Agent Profile
```

The selected profile then controls behavior and access. The category itself does not directly grant access.

### Internal / desk users

The admin directly assigns a profile via `Nexus User Profile Assignment`. At runtime, the system loads the active assignment for the authenticated user. If no assignment exists, the request is rejected.

### API / non-chat channels

Non-chat or direct integrations should pass an explicit agent/profile context or use the channel's configured agent path. There is no separate channel-level profile route DocType in the active runtime model.

### Access handoff

Before calling Nexus Core, Live must pass the resolved profile as `query_contract.ai_profile.name`. Nexus Core then resolves:

```
Nexus AI Agent Profile
  → Nexus AI Agent Profile Access Category
  → Nexus Access Category Policy
  → allowed_access_policies
```

Calling access resolution before the profile is present produces an empty policy list and retrieval is denied.

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
