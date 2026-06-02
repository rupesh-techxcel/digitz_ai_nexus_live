# Escalation

Escalation transfers a conversation from an AI agent to a human agent when the AI cannot adequately answer. It is triggered automatically by confidence scoring or explicitly by a user request.

---

## Escalation Triggers

`escalation_service.should_escalate(...)` checks three conditions (any one is sufficient):

| Condition | Field | Notes |
|---|---|---|
| Low confidence | `confidence < escalation_rule.minimum_confidence` | Default threshold is 0.65 |
| No knowledge | `no_knowledge = True` | Retrieval returned no relevant chunks |
| User requested human | `user_requested_human = True` | Detected from user message keywords |

If the agent's behavior profile has `escalation_enabled = False`, escalation is never triggered regardless of confidence.

---

## Escalation Rules

Each `Nexus Escalation Rule` defines the trigger conditions and target for a given agent role:

| Field | Purpose |
|---|---|
| `rule_name` | Display name |
| `agent_role` | Which agent role this rule applies to (e.g. Sales, Support) |
| `minimum_confidence` | Confidence threshold that triggers escalation (default 0.65) |
| `escalate_on_no_knowledge` | Escalate when retrieval finds nothing |
| `escalate_on_human_request` | Escalate when user asks for a human |
| `target_queue` | Link → Nexus Agent Queue |
| `target_agent` | Link → Nexus Live Agent (direct assignment, overrides queue) |
| `rule_conditions_json` | Custom condition JSON for advanced rules |

Rules are looked up by `agent_role`. If no rule exists for the agent's role, escalation cannot proceed — this is a configuration error.

---

## Escalation Flow

```
should_escalate() returns True
    │
    ▼
get_escalation_rule(agent_role)
─ Look up Nexus Escalation Rule by agent_role
─ Error if not found
    │
    ▼
Select target agent:
─ If target_agent is set → use that agent directly
─ Else: get_queue_agents(target_queue)
        → select first available human agent from queue
    │
    ▼
update_conversation_assignment(conversation, human_agent)
─ Update assigned_agent and assigned_agent_type on conversation
    │
    ▼
mark_escalated(conversation)
─ Set conversation.status = "Escalated"
─ Set conversation.escalation_status = "Pending"
    │
    ▼
create_escalation(conversation, reason)
─ Create Nexus Live Escalation record
─ Record: conversation, reason, from_agent, to_agent, escalated_at
```

---

## Agent Queues

Queues group human agents for load-balanced escalation targeting. The escalation rule points to a queue, and `escalation_service` picks the first available agent from the queue.

**Nexus Agent Queue** — named group of human agents.

**Nexus Queue Assignment** — maps a `Nexus Live Agent` to a `Nexus Agent Queue`. One agent can be in multiple queues.

```
Nexus Escalation Rule
└── target_queue → Nexus Agent Queue
                    └── Nexus Queue Assignment (1:many)
                            └── Nexus Live Agent
```

When all agents in a queue are at capacity or unavailable, `get_queue_agents` returns an empty list and escalation records a `no_agent_available` state rather than silently failing.

---

## Escalation States

A conversation's `escalation_status` field:

| Value | Meaning |
|---|---|
| (empty) | No escalation pending |
| Pending | Escalation triggered, awaiting human pickup |
| Assigned | Human agent has taken the conversation |
| Resolved | Human agent closed the escalation |

---

## Fallback Behavior

When escalation is triggered but no human agent is available:

- The conversation is still marked `Escalated`
- The AI's final answer is the `fallback_message` from the behavior profile
- The escalation record captures `escalation_reason` and `no_agent_available = True`
- The human operations team can pick up the conversation from the Nexus Live Console

This ensures conversations are never silently dropped.
