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

Behavior is defined in `Nexus AI Behaviour` (preferred) or the legacy `Nexus AI Agent Profile`. The behavior profile is resolved at query time in this priority order:

1. `Nexus AI Behaviour` linked on the agent (`agent.behaviour`)
2. `Nexus AI Agent Profile` linked on the agent (legacy fallback)

The resolved profile is passed as `ai_profile` in the query payload to Nexus Core.

### Nexus AI Behaviour Fields

| Field | Purpose |
|---|---|
| `behaviour_code` | Unique identifier for routing and referencing |
| `behaviour_name` | Display name |
| `designation` | Role label shown to visitors (e.g. "AI Assistant") |
| `behavior_prompt` | System prompt injected into LLM context |
| `tone` | Professional / Consultative / Supportive / Technical / Friendly / Formal |
| `response_style` | Balanced / Concise / Step-by-step / Detailed / Persuasive |
| `memory_mode` | None (stateless) / Session (conversation history) |
| `confidence_threshold` | Below this score, escalation is triggered |
| `escalation_enabled` | Whether this behavior supports escalation at all |
| `welcome_message` | Greeting shown at conversation start |
| `fallback_message` | Response when confidence is too low |
| `do_not_answer_rules` | Topics the agent must not address |

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
