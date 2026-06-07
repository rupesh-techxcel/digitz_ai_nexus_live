# Escalation

Escalation transfers a conversation from an AI agent to a human agent when the user explicitly requests it. It is a deliberate user action, not an automatic system response to low confidence.

---

## Escalation Trigger

Escalation fires when **both** conditions are met:

| Condition | How it is set |
|---|---|
| `user_requested_human = True` | Router LLM matches the user message against the "Human Agent Request" intent handler (or any custom escalation intent) and returns `ACTION:ESCALATE` |
| `escalation_enabled = True` | Set on the conversation's resolved `Nexus AI Agent Profile` |

If `escalation_enabled = False` on the profile, escalation never fires regardless of what the user says.

**Low confidence and RAG fallback do not trigger escalation.** When the AI cannot find an answer, it responds gracefully via the LLM Host and invites a follow-up question. The user decides whether to escalate by explicitly asking.

---

## How Escalation is Detected

The escalation request is detected by the LLM router, not by keyword matching.

1. `resolve_intents_for_profile(profile_name)` loads the resolved intent list, which includes the "Human Agent Request" handler (or any profile-customised variant).
2. The router receives this list as `SPECIAL CASES` in its prompt.
3. If the user's message matches the escalation intent, the router outputs `ACTION:ESCALATE`.
4. `answer_query()` sets `user_requested_human: True` in the response.
5. `live_chat_service._process_ai_response()` reads this flag and calls `create_escalation()`.

This means escalation detection is driven by the intent handler's `trigger_description` — it can be adjusted without code changes.

---

## Escalation Flow

```
User message: "Can I speak to someone?" / "Connect me to support" / etc.
    │
    ▼
Router LLM matches "Human Agent Request" intent handler
    │
    ▼
answer_query() returns:
    {
        access_status: "intent_handled",
        answer: "<response_template from intent handler>",
        user_requested_human: True,
        intent_action: "escalate"
    }
    │
    ▼
live_chat_service checks:
    user_requested_human = True
    escalation_enabled = True (from profile)
    │
    ▼
create_escalation(
    conversation,
    reason="User Requested Human",
    from_agent,
    confidence,
    remarks="User explicitly requested escalation to a human agent."
)
    │
    ▼
get_escalation_rule(agent_role)
─ Look up Nexus Escalation Rule by agent_role
─ Configuration error if no rule found
    │
    ▼
Select target agent:
─ If target_agent is set → use that agent directly
─ Else: get_queue_agents(target_queue)
        → select first available human agent from queue
    │
    ▼
update_conversation_assignment(conversation, human_agent)
─ Update assigned_agent on conversation
    │
    ▼
mark_escalated(conversation)
─ Set conversation.status = "Escalated"
─ Set conversation.escalation_status = "Pending"
    │
    ▼
create Nexus Live Escalation record
─ Captures: conversation, reason, from_agent, to_agent, escalated_at
```

---

## Escalation Rules

Each `Nexus Escalation Rule` defines the target for escalations from a given agent role:

| Field | Purpose |
|---|---|
| `rule_name` | Display name |
| `agent_role` | Which agent role this rule applies to (e.g. Sales, Support) |
| `target_queue` | Link → Nexus Agent Queue (load-balanced selection) |
| `target_agent` | Link → Nexus Live Agent (direct assignment; overrides queue) |
| `rule_conditions_json` | Custom condition JSON for advanced rules |
| `enabled` | Whether this rule is active |

Rules are looked up by `agent_role`. If no enabled rule exists for the agent's role, escalation cannot proceed — this is a configuration error that should be resolved before deploying escalation-enabled profiles.

---

## Agent Queues

Queues group human agents for load-balanced escalation targeting.

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
| (empty) | No escalation |
| Pending | Escalation triggered, awaiting human pickup |
| Assigned | Human agent has taken the conversation |
| Resolved | Human agent closed the escalation |

---

## Customising Escalation Behaviour

The escalation intent ("Human Agent Request") is a regular `Nexus Intent Handler` record. It can be customised:

- **Globally:** Edit the "Human Agent Request" handler's `trigger_description` to adjust how broadly the LLM detects escalation requests.
- **Per profile:** Use `Nexus Profile Intent Override` on the agent profile to:
  - `disabled = True` — prevent escalation for this profile entirely (even if user asks)
  - `override_response` — replace the acknowledgement message for this profile
  - `decline_response` — what to say when a user asks for escalation but it is disabled

Example: A purely automated FAQ bot profile can disable the escalation intent entirely, so requests for human agents receive a polite decline rather than creating an escalation.

---

## Fallback Behavior

When escalation is triggered but no human agent is available:

- The conversation is still marked `Escalated`
- The AI's response (from the intent handler's `response_template`) is already delivered
- The escalation record captures `no_agent_available = True`
- The human operations team can pick up the conversation from the Nexus Live Console

This ensures conversations are never silently dropped.
