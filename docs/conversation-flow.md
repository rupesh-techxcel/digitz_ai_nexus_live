# Conversation Flow

Nexus Live supports two conversation types: **Q&A** (stateless single-exchange) and **Chat** (stateful multi-turn). They share the same agent routing and access resolution infrastructure but differ in state management.

---

## Q&A Flow

Q&A is stateless. Each call is independent — no conversation document is created, no history is stored.

```
POST ask_question(payload)
    │
    ▼
Enrich payload
─ Resolve tenant context
─ Resolve allowed access policies
─ Apply channel defaults
    │
    ▼
Assign agent
─ Detect required role
─ Select available agent
─ Load behavior profile
    │
    ▼
Call Nexus Core answer_service.answer_query(payload)
    │
    ▼
Return:
  answer, confidence, sources, access_status,
  agent_code, agent_name, fallback_used
```

Use Q&A for:
- Public website widgets with single-question interaction
- API integrations that do not maintain session state
- Knowledge lookups that do not require conversation context

---

## Chat Flow

Chat is stateful. A `Nexus Live Conversation` document is created on the first message and carries a `conversation_id` that the client must include in all follow-up messages.

### Starting a Chat

```
POST start_chat(payload)
    │
    ▼
Enrich payload
    │
    ▼
Assign agent
    │
    ▼
Create Nexus Live Conversation
─ Generates unique conversation_id (NLCV-XXXXX format)
─ Sets status = Open
─ Records assigned_agent, channel, visitor info
    │
    ▼
Call Nexus Core with conversation context
    │
    ▼
Persist messages:
  Nexus Live Message (role=user, content=query)
  Nexus Live Message (role=assistant, content=answer)
    │
    ▼
Return:
  conversation_id, answer, confidence, agent_code
```

### Continuing a Chat

```
POST send_chat_message(conversation_id, payload)
    │
    ▼
Load Nexus Live Conversation
    │
    ▼
Load message history (max 20 messages)
    │
    ▼
Build context continuity payload
─ Format previous messages as conversation_context string
─ Set is_follow_up = True
─ Preserve tenant, channel, access policies from conversation
    │
    ▼
Call Nexus Core with full context
    │
    ▼
Evaluate escalation
(see Escalation doc)
    │
    ├── Should escalate → mark conversation Escalated, create escalation record
    │
    ▼
Persist messages
    │
    ▼
Return:
  answer, confidence, escalation_status, sources
```

---

## Conversation States

```
Open → Responding → Waiting → Escalated → Handed Over → Closed
```

| State | Meaning |
|---|---|
| Open | Conversation started, agent assigned |
| Responding | AI is generating a response |
| Waiting | Awaiting user's next message |
| Escalated | Handed to an escalation queue, awaiting human |
| Handed Over | Assigned to a specific human agent |
| Closed | Conversation ended |

State transitions are managed by `conversation_service`. The conversation document is not deleted on close — it is archived for analytics and audit.

---

## Context Continuity

For chat conversations, each follow-up message includes the full conversation history so the LLM can answer in context. `conversation_context_service.build_chat_continuity_payload` does this:

1. Fetch up to 20 prior messages from `Nexus Live Message`
2. Format them as a structured conversation string:
   ```
   User: <message>
   Assistant: <response>
   User: <message>
   ...
   ```
3. Inject into `payload.conversation_context`
4. Set `payload.is_follow_up = True`

The Nexus Core prompt builder uses `conversation_context` to produce continuity-aware responses.

---

## Message Persistence

Each message in a conversation is stored as a `Nexus Live Message` record:

| Field | Value |
|---|---|
| conversation | Link → Nexus Live Conversation |
| sender_type | user / assistant / system |
| message | Message content |
| confidence | AI confidence score (for assistant messages) |
| sources | JSON list of source references |
| sent_at | Timestamp |

Messages are append-only. They are never modified after creation.

---

## Visitor Information

The conversation captures visitor metadata at creation time:

- `visitor_name` — provided by the client or defaulted to "Guest"
- `visitor_email` — optional, used for lead capture and follow-up
- `visitor_phone` — optional
- `user_type` — Guest / Website User / Desk User

For authenticated users, `user_type` is resolved from the session. For public visitors, it is always `Guest`.

---

## Conversation Participants

`Nexus Conversation Participant` tracks multiple parties in a conversation — useful when a human agent joins an escalated chat alongside the AI transcript. Each participant record has:

- `conversation` — link to parent conversation
- `participant_type` — visitor / agent / system
- `agent` — optional link to Nexus Live Agent
- `joined_at`, `left_at`
