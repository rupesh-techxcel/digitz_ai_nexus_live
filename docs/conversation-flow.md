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
Enrich payload (apply_session_user_context)
    │
    ├── Desk / internal user path ──────────────────────────────────────────────
    │    Resolve Nexus User Profile Assignment → ai_profile_override
    │    payload["agent"] = ai_profile_override.agent_name  (if assignment found)
    │    fallback visibility = "Internal"
    │
    └── External / guest user path ─────────────────────────────────────────────
         Resolve identity_type (6-step priority chain — see identity-resolution.md)
         If chat_category in payload:
             Resolve Nexus Category Identity Route → AI Agent Profile
         Assign agent
    │
    ▼
Create Nexus Live Conversation
─ Generates unique conversation_id (NLCV-XXXXX format)
─ Sets status = Open
─ Records assigned_agent, channel, tenant, visitor info
─ Freezes ai_profile_snapshot_json (behavior + knowledge_profile_names)
    │
    ▼
Resolve access policies from snapshot
    │
    ▼
If no initial message: send personalized greeting using agent nickname (e.g. `"Hi! I'm {agent_nick}, your AI assistant. It's great to have you here!"`), then collect visitor name (public) or resolve it from Frappe User (desk), and set intent = await_category (if no category yet)
If message provided: enqueue background AI response
    │
    ▼
Return:
  conversation_id, greeting, agent_name, agent_code
  (AI answer, if any, arrives via realtime nexus_chat_response event)
```

### Continuing a Chat

```
POST send_chat_message(conversation_id, payload)
    │
    ▼
Load Nexus Live Conversation + message history (max 20 messages)
    │
    ▼
Special intents handled synchronously (no AI call):
─ intent = await_category  AND  message starts with "__cat__:"
    → resolve Nexus Chat Category by category_code field
    → store chat_category on conversation, send acknowledgement
─ intent = await_name
    → capture visitor_name, proceed to category picker or processing
    │
    ▼
Build context continuity payload
─ Format prior messages as conversation_context string
─ Set is_follow_up = True
─ Restore tenant, channel, identity_type from conversation snapshot
─ Restore knowledge_profile_names from ai_profile_snapshot_json
─ Resolve allowed_access_policies from snapshot before retrieval
    │
    ▼
Enqueue background AI response (_enqueue_ai_response)
─ answer_query (Nexus Core) with full context
─ check fallback_used flag in response
─ if Public visitor AND fallback_used → set identity_verification_offer = True
    │
    ▼
Evaluate escalation (escalation_service.should_escalate)
    │
    ├── Should escalate → mark Escalated, create escalation record
    │
    ▼
Persist messages
    │
    ▼
Publish realtime nexus_chat_response:
  { answer, identity_verification_offer, fallback_used, response_type, ... }
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

## Identity Verification Offer

When a **Public visitor** (identity_type = "Public") asks a question and the retrieval engine finds nothing under public access (`fallback_used = True`), the system offers identity verification instead of a dead-end reply.

```
AI response (background worker)
    │
    ├── fallback_used = True  AND  identity_type = "Public"
    │       ↓
    │   answer  = PUBLIC_IDENTITY_FALLBACK message (explains the offer)
    │   identity_verification_offer = True
    │
    ▼
Realtime nexus_chat_response published with identity_verification_offer: true
    │
    ▼
Widget (non-desk only):
    render_identity_verification_prompt()
    │
    ├── Visitor enters email
    │   → request_identity_verification(conversation_id, email)
    │       Resolves channel + chat_category from conversation record
    │       Issues OTP, returns challenge_token
    │
    ├── Visitor enters OTP
    │   → verify_identity_verification(challenge_token, otp)
    │       Sets challenge status = Verified, resolved_identity_type recorded
    │
    └── Widget stores challenge_token in state (S.identity_verification_challenge)
        Subsequent messages include identity_verification_challenge in payload
        identity_resolver Step 2 upgrades identity type from the verified challenge
```

The conversation identity is NOT changed mid-session — the snapshot is frozen. The upgraded identity takes effect in the **next new conversation** the visitor starts, or in the remaining messages of the current one if the challenge is verified before the next send.

---

## Visitor Information

The conversation captures visitor metadata at creation time:

- `visitor_name` — resolved differently by path:
  - **Public visitors**: always collected via the onboarding name-prompt (step 10a in the visitor path). The prompt `"Could you please share your name?"` is sent after the initial greeting and `conversation.intent` is set to `await_name`. The name is stored when the visitor replies.
  - **Desk (internal) users**: resolved automatically from the Frappe `User` record (`frappe.get_value("User", session_user, "first_name")`) immediately after `create_conversation`. No name prompt is shown.
- `visitor_email` — optional; also stored in widget state (`S.visitor_email`) after identity verification
- `visitor_phone` — optional
- `user_type` — Guest / Website User / Desk User

For authenticated users, `user_type` is resolved from the session. For public visitors, it is always `Guest`.

**Widget identity state** (cleared on every new conversation):
- `S.visitor_email` — set after OTP email submission
- `S.identity_verification_challenge` — set after successful OTP verification; injected into every subsequent message payload

---

## Conversation Participants

`Nexus Conversation Participant` tracks multiple parties in a conversation — useful when a human agent joins an escalated chat alongside the AI transcript. Each participant record has:

- `conversation` — link to parent conversation
- `participant_type` — visitor / agent / system
- `agent` — optional link to Nexus Live Agent
- `joined_at`, `left_at`
