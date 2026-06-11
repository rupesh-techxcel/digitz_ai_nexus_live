# Escalation

Escalation transfers a conversation from an AI agent to a human agent when the user explicitly requests it. It is a deliberate user action, not an automatic system response to low confidence.

---

## Escalation Trigger

Escalation fires when **all three** conditions are met:

| Condition | How it is set |
|---|---|
| `user_requested_human = True` | Router LLM matches the user message against the "Human Agent Request" intent handler (or any custom escalation intent) and returns `ACTION:ESCALATE` |
| `escalation_enabled = True` | Set on the conversation's resolved `Nexus AI Agent Profile` |
| `enable_escalation = 1` | Set on the `Nexus Chat Category` the conversation is in |

If any condition is false, escalation does not fire. The category flag (`enable_escalation`) lets admins block human escalation for specific categories (e.g., a simple FAQ category) without touching the AI profile.

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
    escalation_enabled = True (from Nexus AI Agent Profile)
    category_allows_escalation = True (Nexus Chat Category.enable_escalation)
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
mark_escalated(conversation)
─ Set conversation.status = "Escalated"
─ Set conversation.escalation_status = "Pending"
─ Set conversation.escalated_at = now_datetime()
    │
    ▼
create Nexus Live Escalation record
─ Captures: conversation, reason, from_agent, escalated_at
    │
    ▼
publish_escalation_alert(conversation)
─ Finds agents with can_handle_escalations=1 assigned to this chat_category
  via Nexus User Profile Assignment.escalation_categories
─ Publishes nexus_escalation_alert to each agent's user room (personal alert)
─ Falls back to broadcast if no agents configured
```

### After Escalation: Handling Visitor Messages

While `conversation.status = "Escalated"`, `continue_live_chat` does NOT invoke the AI. Instead:
1. Visitor messages are stored and forwarded to the agent panel via `response_type="visitor_message"`
2. The visitor receives a holding acknowledgement via `response_type="message_held"`
3. The human agent responds via `agent_send_message` → `response_type="message"` with `sender_type="Human Agent"`

---

## Escalation Rules

`Nexus Escalation Rule` records are used by `create_escalation` to determine which AI agent profile (`to_agent`) or queue (`to_queue`) to record on the `Nexus Live Escalation` document. This provides an audit trail of intended routing.

> **Note:** `Nexus Escalation Rule` governs what is **recorded** on the escalation record, not which human agents receive realtime alerts. Human agent alerting is controlled separately by `Nexus User Profile Assignment.escalation_categories`.

| Field | Purpose |
|---|---|
| `rule_name` | Display name |
| `agent_role` | Which AI agent role this rule applies to |
| `target_queue` | Link → Nexus Agent Queue (records intended queue) |
| `target_agent` | Link → Nexus AI Agent Profile (direct; overrides queue) |
| `enabled` | Whether this rule is active |

If no enabled rule exists for the agent's role, `to_agent` and `to_queue` are left blank on the escalation record — escalation still proceeds normally.

---

## Agent Queues

`Nexus Agent Queue` groups AI agent profiles for load-balanced routing records.

```
Nexus Escalation Rule
└── target_queue → Nexus Agent Queue
                    └── Nexus Queue Assignment (1:many)
                            └── Nexus AI Agent Profile
```

The first available agent from the queue is recorded as `to_agent` on the `Nexus Live Escalation` document.

---

## Escalation States

A conversation's `escalation_status` field:

| Value | Meaning |
|---|---|
| (empty) | No escalation |
| Pending | Escalation triggered; no human agent has claimed it yet |
| Accepted | A human agent has claimed the conversation (`claim_conversation` called); `human_agent` field is set |
| Resolved | Human agent resolved the escalation (`resolve_escalation` called); AI resumes |

The corresponding `Nexus Live Escalation` record also tracks `status` (Pending → Resolved).

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
