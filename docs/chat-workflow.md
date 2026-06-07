# Chat Workflow

This document covers the full specification of the live chat system in `digitz_ai_nexus_live` — from the moment a visitor sends their first message to the AI answer arriving in their browser.

---

## Architecture Overview

```
Browser / Client
    │
    │  HTTP (frappe.call)
    ▼
API Layer (api/live.py)
    │
    │  Synchronous: store message, create conversation
    ▼
live_chat_service.py
    │
    │  frappe.enqueue (queue: short, timeout: 120s)
    ▼
Background Worker
    │  _process_ai_response()
    │      ├── build payload (incl. resolved_intents)
    │      ├── answer_query()  ← digitz_ai_nexus core
    │      │       ├── length guard
    │      │       ├── LLM router (intent / conversational / knowledge)
    │      │       └── RAG pipeline (if knowledge_seeking)
    │      ├── persist AI message
    │      ├── check escalation (user_requested_human only)
    │      └── publish_realtime
    │
    │  frappe.realtime (Socket.io)
    ▼
Browser / Client
    │  frappe.realtime.on("nexus_chat_response")
    ▼
Render AI message
```

The HTTP call returns immediately. The AI answer is pushed separately via Frappe's Socket.io realtime layer. This means the browser never blocks waiting for the LLM.

---

## Chat Mode Pipeline (answer_query in chat mode)

Before the RAG pipeline runs, `answer_query()` applies two pre-checks in chat mode:

```
answer_query(chat mode)
│
├── 1. Length Guard
│       If message > 500 characters:
│           → LLM generates a friendly nudge to shorten the question
│           → Return immediately, no RAG
│
├── 2. LLM Router + Intent Handler
│       route_intent(payload)
│           → LLM receives: user message + conversation context + resolved intent handlers
│           │
│           ├── ACTION:ESCALATE
│           │       User explicitly wants a human agent
│           │       → Return answer from intent handler's response_template
│           │       → Set user_requested_human = True in response
│           │       → live_chat_service creates escalation
│           │
│           ├── ACTION:PREDEFINED:<name>
│           │       Matched a configured special case
│           │       → Return that handler's response_template
│           │
│           ├── ACTION:DECLINED:<name>
│           │       Intent exists but is disabled for this profile
│           │       → Return the profile's decline_response
│           │
│           ├── Conversational response (1-2 sentences)
│           │       Greeting, introduction, small talk, social exchange
│           │       → Return LLM response directly, skip RAG
│           │
│           └── ROUTE_TO_KNOWLEDGE
│                   Question needs knowledge lookup
│                   → Fall through to RAG pipeline
│
└── 3. RAG Pipeline (knowledge_seeking only)
        If RAG finds no usable knowledge:
            → LLM Host generates graceful fallback (no facts, no "connect with team" offers)
        If RAG finds knowledge:
            → LLM answers from approved knowledge only
```

---

## Realtime Events

Both events carry `conversation_id` in the payload so the client can match events to the correct chat window.

### `nexus_chat_response`

Fired when the AI response is ready (or when an error occurs).

**Success payload:**
```json
{
    "conversation_id": "ABC123DEF456",
    "status": "success",
    "conversation": "Nexus Live Conversation/NLC-00001",
    "agent": "PUBLIC-AI-ASSISTANT",
    "agent_code": "PUBLIC-AI-ASSISTANT",
    "agent_name": "Public AI Assistant",
    "message": "Here is the answer to your question...",
    "answer": "Here is the answer to your question...",
    "confidence": 0.87,
    "sources": [...],
    "escalated": false,
    "escalation": null,
    "confidence_threshold": 0.65,
    "fallback_used": 0,
    "tenant": "DIGITZ-NEXUS",
    "channel": "WEBSITE-CHAT",
    "resolved_tenant_context": {...}
}
```

**Error payload:**
```json
{
    "conversation_id": "ABC123DEF456",
    "status": "error",
    "error": "AI response failed. Please try again."
}
```

### `nexus_chat_typing`

Fired just before the AI pipeline starts, so the client can show a typing indicator.

```json
{
    "conversation_id": "ABC123DEF456"
}
```

### Client subscription

```javascript
frappe.realtime.on("nexus_chat_response", function(data) {
    if (data.conversation_id !== my_conversation_id) return;

    hide_typing_indicator();

    if (data.status === "error") {
        show_error(data.error);
    } else {
        render_message({
            sender_type: "AI Agent",
            message: data.message,
            confidence: data.confidence,
        });
    }
});

frappe.realtime.on("nexus_chat_typing", function(data) {
    if (data.conversation_id === my_conversation_id) {
        show_typing_indicator();
    }
});
```

---

## API Endpoints

All endpoints are in `digitz_ai_nexus_live.api.live`.

### `get_channel_categories`

```
Method : GET
Auth   : allow_guest=True
Args   : channel (required), visitor_email (optional)
```

Returns the list of chat categories that the current visitor can use on the given channel. Filters by:
1. `requires_authentication` — hides auth-only categories from guests
2. Active route existence — only shows categories that have a `Nexus Category Identity Route` for the visitor's resolved identity type

**Response:**
```json
{
    "channel": "WEBSITE-CHAT",
    "is_authenticated": false,
    "identity_type": "Public",
    "categories": [
        {
            "name": "GENERAL-SUPPORT",
            "category_code": "GENERAL-SUPPORT",
            "category_label": "General Support",
            "display_order": 1,
            "description": "...",
            "identity_verification_mode": "None",
            "allow_public_fallback": 0
        }
    ]
}
```

---

### `start_chat`

```
Method : POST
Auth   : allow_guest=True
Args   : payload (JSON string or dict)
```

Starts a new live chat conversation. Stores the visitor's first message immediately and enqueues the AI processing job. Returns fast — the AI answer arrives via `nexus_chat_response` realtime event.

**Request payload fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | String | Yes | The visitor's first message (max 500 characters) |
| `channel` | String | Recommended | `Nexus Live Channel.channel_code`; resolved from tenant config if absent |
| `chat_category` | String | Recommended | `Nexus Chat Category.category_code`; drives profile routing |
| `tenant` | String | No | Resolved from user context if absent |
| `business_unit` | String | No | Resolved from tenant config if absent |
| `project` | String | No | |
| `context` | String | No | |
| `sub_context` | String | No | |
| `entity_type` | String | No | |
| `entity` | String | No | |
| `topic` | String | No | |
| `visitor_name` | String | No | |
| `visitor_email` | String | No | Used for identity resolution |

**Response:**
```json
{
    "status": "processing",
    "conversation": "NLC-00001",
    "conversation_id": "ABC123DEF456",
    "agent": "PUBLIC-AI-ASSISTANT",
    "agent_code": "PUBLIC-AI-ASSISTANT",
    "agent_name": "Public AI Assistant"
}
```

---

### `send_chat_message`

```
Method : POST
Auth   : allow_guest=True
Args   : conversation_id (required), payload (JSON string or dict)
```

Sends a follow-up message in an existing conversation. Same async pattern as `start_chat`.

**Request payload fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | String | Yes | Max 500 characters |
| `tenant` | String | Recommended | Must match the conversation's tenant |

All other fields (channel, context, identity, etc.) are re-enriched from the conversation document automatically and do not need to be re-sent.

**Response:**
```json
{
    "status": "processing",
    "conversation": "NLC-00001",
    "conversation_id": "ABC123DEF456"
}
```

---

### `get_active_conversations`

```
Method : GET
Auth   : Desk users only (no allow_guest)
Args   : limit (default: 50)
```

Returns conversations with status `Open`, `Responding`, or `Escalated`. Used by the Nexus Live Console.

---

### `get_conversation_detail`

```
Method : GET
Auth   : Desk users only
Args   : conversation_id (required)
```

Returns full conversation metadata and all messages. Used by the Nexus Live Console when a conversation is opened.

---

## Start Chat Flow (Detailed)

```
start_chat(payload)
│
├── 1. Validate: message required
│
├── 2. apply_session_user_context(payload)
│       Sets user_type: "Guest" | "Website User" | "Desk User"
│       Sets user: { id, roles, email } if authenticated
│
├── 3. Identity Verification (external visitors only, if chat_category set)
│       enforce_category_verification(payload)
│       Checks Nexus Identity Verification Challenge for the category
│       If a verified challenge exists → sets payload.identity_registry
│
├── 4. apply_tenant_context_to_payload(payload)
│       Resolves tenant, business_unit, project, context, channel from:
│       - Explicit payload values (highest priority)
│       - Active user context (Nexus User Context)
│       - Tenant configuration defaults (Nexus Tenant Configuration)
│
├── 5. Behavior Pre-resolution
│   ├── If internal desk user:
│   │       resolve_behavior_for_internal_user(session_user)
│   │       → Nexus User Profile Assignment → Nexus AI Agent Profile
│   │       Throws if no assignment and user is not System Manager
│   │
│   └── If external visitor with chat_category:
│           resolve_identity_type(payload)
│               Priority: explicit identity_type → registered challenge identity
│               → authenticated user role → public fallback
│           resolve_behavior_from_chat_category(category, identity_type, is_authenticated)
│               → Nexus Category Identity Route → Nexus AI Agent Profile
│           Throws if no active route found
│           resolve_identity_registry_name(payload)
│           resolve_identity_safeguard_access_categories(payload)
│               → Nexus Identity Registry Safe Guard categories (if registered)
│
├── 6. Agent Assignment
│       assign_agent(payload)
│       → Finds first approved Idle AI agent matching channel/role/visibility
│       Throws if no agent available
│
├── 7. create_conversation(payload, agent, ai_profile_override)
│       Creates Nexus Live Conversation with status=Open
│       Snapshots ai_profile_snapshot_json for consistent behavior across turns
│
├── 8. update_conversation_assignment(conversation, agent)
│       Sets conversation.status = "Responding"
│
├── 9. Store visitor message immediately
│       add_message(conversation, sender_type="Visitor"|"User", message)
│
├── 10. _enqueue_ai_response(conversation_id, payload)
│        frappe.enqueue(queue="short", timeout=120)
│
└── 11. Return immediately:
        { status: "processing", conversation_id, agent, agent_code, agent_name }
```

---

## Continue Chat Flow (Detailed)

```
send_chat_message(conversation_id, payload)
│
├── 1. apply_session_user_context(payload)
│
├── 2. get_conversation(conversation_id)
│       Lookup by conversation_id or document name
│       Throws if not found or no assigned_agent
│
├── 3. Validate: message required
│
├── 4. enrich_payload_from_conversation(payload, conversation)
│       Re-fills: tenant, business_unit, project, channel, chat_category,
│                 identity_type, identity_registry, context, sub_context,
│                 entity_type, entity, topic
│       Priority: explicit payload → conversation fields
│       Restores identity_safeguard_access_categories from conversation JSON
│       Applies apply_tenant_context_to_payload to fill any remaining gaps
│
├── 5. Store visitor message immediately
│       sender_type = "Visitor" (Guest) or "User" (authenticated)
│       add_message(conversation, sender_type, message)
│
├── 6. _enqueue_ai_response(conversation_id, payload)
│
└── 7. Return immediately:
        { status: "processing", conversation_id }
```

---

## Background AI Processing (_process_ai_response)

This runs in a Frappe background worker (queue: `short`, timeout: 120s).

```
_process_ai_response(conversation_id, payload_json)
│
├── 1. Load conversation document
│
├── 2. Load assigned Nexus Live Agent
│
├── 3. _resolve_behavior(payload, conversation, agent)
│       Priority order:
│       a) Stored profile on conversation (ai_profile_snapshot_json)
│              → ensures behavior is consistent for all turns in the same conversation
│       b) Internal desk user's active Nexus User Profile Assignment
│       c) chat_category in payload → Nexus Category Identity Route → Nexus AI Agent Profile
│       d) Agent's own behavior (legacy / non-category path)
│
├── 4. set_agent_status(agent, "Responding")
│
├── 5. publish_chat_typing(conversation_id)
│       → fires nexus_chat_typing event; client shows typing indicator
│
├── 6. build_core_chat_payload(payload, conversation, agent, behavior)
│   │
│   ├── build_chat_continuity_payload()
│   │       Detects if this is a follow-up question
│   │       Builds conversation_context string from prior message pairs
│   │       Sets effective_query (may rephrase follow-up for standalone retrieval)
│   │
│   ├── build_chat_history() — last 20 messages (MAX_HISTORY_MESSAGES)
│   │
│   ├── _build_ai_profile_dict(behavior)
│   │       Packages: behavior_prompt, tone, response_style, welcome_message,
│   │                 fallback_message, do_not_answer_rules, confidence_threshold,
│   │                 escalation_enabled, escalation_policy, memory_mode,
│   │                 category_code, identity_type
│   │
│   ├── resolve_intents_for_profile(profile_name)
│   │       Loads global Nexus Intent Handler records (enabled, ordered by priority)
│   │       Applies profile-level overrides from Nexus Profile Intent Override child table
│   │       Returns resolved list with: name, intent_name, trigger_description,
│   │                                   action_type, response_template, active,
│   │                                   decline_response
│   │       → Stored as "resolved_intents" in core payload
│   │
│   └── resolve_allowed_policies(...)
│           Computes the set of Nexus Access Policies the conversation can retrieve from:
│           - ai_profile access categories → their policies
│           - intersected with identity_safeguard_access_categories (if set)
│           - force_public_only=True when no named profile or identity is "Public"/Guest
│
├── 7. answer_query(core_payload)  ← digitz_ai_nexus core
│   │
│   ├── Length Guard (chat mode only)
│   │       If message > 500 chars → LLM generates a friendly nudge, return immediately
│   │
│   ├── Intent Router (chat mode only)
│   │       LLM call: user message + conversation context + resolved_intents
│   │       │
│   │       ├── ACTION:ESCALATE
│   │       │       → access_status: "intent_handled"
│   │       │       → user_requested_human: True (→ live_chat_service escalates)
│   │       │       → answer: from intent handler's response_template
│   │       │
│   │       ├── ACTION:PREDEFINED:<name>
│   │       │       → access_status: "intent_handled"
│   │       │       → answer: from handler's response_template (or profile override)
│   │       │
│   │       ├── ACTION:DECLINED:<name>
│   │       │       → access_status: "intent_handled"
│   │       │       → answer: from profile's decline_response
│   │       │
│   │       ├── Conversational response
│   │       │       → access_status: "conversational"
│   │       │       → answer: LLM-generated 1-2 sentence social response
│   │       │
│   │       └── ROUTE_TO_KNOWLEDGE → fall through to RAG pipeline
│   │
│   └── RAG Pipeline (if knowledge_seeking)
│           (see retrieval-and-answer.md)
│           If fallback (chat mode): LLM Host generates graceful response
│               - No facts, no guesses
│               - May ask a clarifying question
│               - Does NOT offer to connect with a team member
│
├── 8. Fallback safety net
│       Empty answer → use behavior.fallback_message or DEFAULT_FALLBACK_ANSWER
│
├── 9. add_message(conversation, sender_type="AI Agent", message=answer,
│                  confidence, sources, retrieval_debug)
│
├── 10. set_agent_status(agent, "Waiting")
│
├── 11. Escalation check
│       Escalation fires ONLY when:
│           user_requested_human = True   (set by ACTION:ESCALATE in router)
│       AND escalation_enabled = True on the behavior profile
│
│       User explicitly asks for a human → router returns ACTION:ESCALATE
│           → answer_query returns user_requested_human: True
│           → live_chat_service creates escalation
│
│       Low confidence and RAG fallback do NOT trigger escalation.
│       Escalation is a deliberate user action, not an automatic system response.
│
│       If triggered:
│           create_escalation(conversation, reason="User Requested Human Agent",
│                             from_agent, confidence)
│               → creates Nexus Live Escalation
│               → sets conversation.status = "Escalated"
│               → sets conversation.escalation_status = "Pending"
│
└── 12. publish_chat_response(conversation_id, result)
        → fires nexus_chat_response event with full result payload
```

---

## Intent Handlers

Intent Handlers are the customisation layer that sits between the conversational router and the RAG pipeline.

### How they work

1. Global handlers are configured in `Nexus Intent Handler` (admin-managed, system-wide).
2. Each handler has a natural-language `trigger_description` — the LLM uses this to decide if the user's message matches.
3. The handler defines what action to take when matched: `escalate` (connect to human) or `predefined_answer` (return a preset response).
4. `Nexus AI Agent Profile` can override global handlers per-profile using the `intent_overrides` child table (`Nexus Profile Intent Override`).
5. `resolve_intents_for_profile()` merges global handlers with profile overrides before each conversation turn.
6. The merged list is passed into the router prompt as `SPECIAL CASES`. The LLM checks them first, before routing rules.

### Action tokens returned by the LLM

| Token | Meaning |
|---|---|
| `ACTION:ESCALATE` | User matched the escalation intent; connect to human |
| `ACTION:PREDEFINED:<name>` | Matched a predefined answer; return the configured response |
| `ACTION:DECLINED:<name>` | Intent exists but is disabled for this profile; decline gracefully |
| `ROUTE_TO_KNOWLEDGE` | Needs a knowledge lookup; proceed to RAG |
| _(text)_ | Conversational response; return directly to user |

### Profile-level customisation

| Override field | Effect |
|---|---|
| `disabled = True` | The LLM is told this intent is unavailable; responds with `decline_response` |
| `override_action_type` | Changes the action for this profile only |
| `override_response` | Replaces the global `response_template` for this profile |
| `decline_response` | What to say when the intent is disabled |

See [intent-handlers.md](intent-handlers.md) for the full reference.

---

## Behavior Resolution

Behavior is resolved once per background job. The conversation's stored profile snapshot is used for all follow-up turns to keep tone, fallback, and access settings consistent throughout the conversation.

```
Priority 1 — Stored profile snapshot (follow-up turns)
    conversation.ai_profile_snapshot_json → behavior dict
    Used whenever the conversation already has an assigned profile

Priority 2 — Internal desk user assignment
    session_user → Nexus User Profile Assignment (active=1)
    → Nexus AI Agent Profile
    Hard error if no assignment and user is not System Manager

Priority 3 — Chat category route (external visitors)
    payload.chat_category + resolved identity_type
    → Nexus Category Identity Route (enabled=1)
    → Nexus AI Agent Profile

Priority 4 — Agent behavior (legacy)
    agent → Nexus AI Agent Profile (linked via agent field)
    Used only when no category is present
```

---

## Identity Resolution

Identity type is determined before agent assignment. It governs which `Nexus Category Identity Route` is selected and whether the identity safe guard access categories apply.

```
resolve_identity_type(payload)
│
├── 1. Explicit payload.identity_type → use as-is if provided
│
├── 2. Registered identity challenge
│       Looks up Nexus Identity Verification Challenge for the visitor's email + category
│       If a verified challenge exists → resolves the registered identity type
│
├── 3. Authenticated user
│       If payload.user_type != "Guest" and user object present → "Customer" (or mapped role)
│
└── 4. Default → "Public"
```

If a verified `Nexus Identity Registry` record exists for the visitor:
- `resolve_identity_safeguard_access_categories(payload)` returns the registry's safe guard categories
- These are stored in the conversation as `identity_safeguard_access_json`
- On each subsequent turn, they are restored from the conversation and passed to `resolve_allowed_policies`
- This caps the AI profile's access categories: only policies in BOTH the profile AND the safe guard apply

---

## Access Policy Resolution

```
resolve_allowed_policies({
    channel,
    user: { roles },
    force_public_only,
    identity_type,
    identity_safeguard_access_categories,
    ai_profile: { name, access categories }
})
→ { allowed_access_policies: ["Public", "Internal", ...] }
```

`force_public_only = True` when:
- No named AI Agent Profile is resolved, OR
- identity_type is "Public" AND user_type is "Guest"

When `force_public_only` is True, only the `Public` access policy is allowed regardless of any profile configuration.

---

## Conversation Lifecycle

```
Status            Meaning
───────────────────────────────────────────────────────
Open              Conversation created, waiting for first AI response
Responding        AI agent is processing (agent status also set to "Responding")
Escalated         User requested human agent; conversation routed to human queue
Closed            Conversation ended

escalation_status (independent field):
None              No escalation
Pending           Escalation created, not yet resolved
Resolved          Human agent resolved the escalation
Rejected          Escalation was rejected
```

Status transitions:

```
create_conversation()            → Open
update_conversation_assignment() → Responding
_process_ai_response() starts   → agent status: Responding
_process_ai_response() ends     → agent status: Waiting
user_requested_human = True     → Escalated / escalation_status: Pending
close_conversation()             → Closed
```

---

## Message Sender Types

| sender_type | Who | When |
|---|---|---|
| `Visitor` | Unauthenticated external visitor | Guest session user |
| `User` | Authenticated desk or portal user | Non-guest session user |
| `AI Agent` | AI response | Background job output |
| `Human Agent` | Human desk agent | Manual escalation response |

`conversation.last_message` is updated only for `Visitor` and `User` messages.
`conversation.last_response` is updated only for `AI Agent` and `Human Agent` messages.

---

## Escalation

Escalation is triggered **only** when the user explicitly requests a human agent and `escalation_enabled = True` on the profile.

The request is detected by the LLM router, which matches the user message against the "Human Agent Request" intent handler (or any custom escalation intent configured in `Nexus Intent Handler`). When matched, the router returns `ACTION:ESCALATE` and `answer_query` sets `user_requested_human: True` in the response.

```
User says: "Can I speak to a human?" or "Connect me to support"
    │
    ▼
Router LLM matches "Human Agent Request" intent
    │
    ▼
answer_query returns:
    { user_requested_human: True, answer: "<template response>" }
    │
    ▼
live_chat_service: user_requested_human = True AND escalation_enabled = True
    │
    ▼
create_escalation(reason="User Requested Human Agent")
```

**Low confidence and RAG fallback do not trigger escalation.** If the AI cannot find an answer, it responds warmly via the LLM Host and invites a narrower follow-up. The user chooses whether to escalate.

See [escalation.md](escalation.md) for the full escalation flow reference.

---

## Background Job Configuration

| Parameter | Value |
|---|---|
| Queue | `short` |
| Timeout | 120 seconds |
| In-test mode | `now=frappe.flags.in_test` (runs synchronously in tests) |
| Worker command | `bench worker --queue short` |

If the worker is not running, jobs queue in Redis and process when a worker starts. The client already received `status: "processing"` and is listening on the socket, so it will receive the answer whenever the worker processes it — even if delayed.

---

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `MAX_HISTORY_MESSAGES` | 20 | Max prior messages sent to LLM for context |
| `CHAT_RESPONSE_SENTENCE_LIMIT` | 6 | Instructs LLM to cap response length |
| `MAX_QUERY_CHARS` | 500 | Maximum user message length; longer messages trigger a friendly nudge |
| `DEFAULT_FALLBACK_ANSWER` | `"I do not have enough approved knowledge to answer this."` | Used when no answer is returned (Q&A mode) |

---

## DocTypes Involved

| DocType | Role |
|---|---|
| `Nexus Live Conversation` | One record per conversation session |
| `Nexus Live Message` | One record per message turn (visitor + AI) |
| `Nexus Live Agent` | Agent record; status toggled Idle → Responding → Waiting |
| `Nexus AI Agent Profile` | Behavior, access categories, thresholds, intent overrides |
| `Nexus Profile Intent Override` | Profile-level overrides for global intent handlers (child table on profile) |
| `Nexus Intent Handler` | Global intent handler definitions (escalation, predefined answers) |
| `Nexus Chat Category` | Visitor-selectable category; drives routing |
| `Nexus Category Identity Route` | Maps channel + category + identity_type → AI Agent Profile |
| `Nexus Identity Registry` | Registered visitor record; holds safe guard access categories |
| `Nexus Identity Verification Challenge` | OTP/verification record per visitor+category session |
| `Nexus Live Escalation` | Escalation record created when user requests human agent |
| `Nexus Escalation Rule` | Defines escalation target by agent role |
| `Nexus Agent Queue` | Human agent queue for escalations |
| `Nexus Live Channel` | Channel configuration (e.g., WEBSITE-CHAT) |

---

## Service Layer Map

| Module | Responsibility |
|---|---|
| `api/live.py` | HTTP endpoints; payload parsing; delegates to services |
| `services/live_chat_service.py` | Start/continue chat; enqueue background job; build AI payload |
| `services/intent_handler_service.py` | Load and merge global intent handlers with profile overrides |
| `services/chat_realtime.py` | `publish_realtime` wrappers for response, typing, error events |
| `services/conversation_service.py` | Conversation and message CRUD |
| `services/agent_router.py` | Agent selection logic |
| `services/agent_service.py` | Agent status management; profile loading |
| `services/profile_resolver.py` | Behavior resolution from conversation, internal user, or category |
| `services/identity_resolver.py` | Identity type and registry resolution |
| `services/identity_verification.py` | OTP/challenge enforcement for categories that require it |
| `services/escalation_service.py` | Escalation rule lookup and escalation creation |
| `services/conversation_context_service.py` | Chat history and follow-up query continuity |
| `digitz_ai_nexus.services.answer_service` | Core routing, retrieval, and LLM answer generation (external) |

---

## Nexus Live Console

The desk-facing conversation monitor at `/nexus-live-console`.

- Loads active conversations via `get_active_conversations`
- Opens a conversation → loads full message thread via `get_conversation_detail`
- Subscribes to `nexus_chat_response` and `nexus_chat_typing` for real-time updates
- Sends messages as a desk user via `send_chat_message`
- Auto-refreshes the conversation list every 15 seconds and after every realtime event
- Desk user messages are stored as `sender_type = "User"` (not Visitor)
- Message input is capped at 500 characters with a live character counter
