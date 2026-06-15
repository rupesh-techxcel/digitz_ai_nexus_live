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

The single event for all server-to-client chat messages. The `response_type` field tells the client how to render it.

| `response_type` | When | Client action |
|---|---|---|
| `message` | Normal AI or human agent message | Render bubble; if `sender_type="Human Agent"` render green with agent name |
| `category_picker` | After greeting when no category selected | Show category selection UI; `categories` array in payload |
| `message_held` | Visitor sends message while escalated and no agent has claimed yet | Show amber system message; input stays disabled |
| `visitor_message` | Visitor message forwarded to agent panel | Agent panel appends the message; **visitor widget ignores this event** (guard: `if (data.response_type === 'visitor_message') return;`) to prevent double-render |
| `agent_joined` | Human agent claimed a non-escalated conversation | Rendered as `append_system_message()` in the widget (yellow italic box): "A support agent is joining this conversation to assist you." |
| `escalation_resolved` | Human agent resolved escalation | Show system message; unlock input |
| `conversation_closed` | Conversation closed (by agent or idle timeout) | Show farewell; lock input permanently |

**AI message payload:**
```json
{
    "conversation_id": "ABC123DEF456",
    "status": "success",
    "response_type": "message",
    "message": "Here is the answer to your question...",
    "answer": "Here is the answer to your question...",
    "confidence": 0.87,
    "sources": [...],
    "escalated": false,
    "escalation": null,
    "confidence_threshold": 0.65,
    "fallback_used": 0,
    "identity_verification_offer": false,
    "agent_code": "PUBLIC-AI-ASSISTANT",
    "agent_name": "Aria",
    "tenant": "DIGITZ-NEXUS",
    "channel": "WEBSITE-CHAT"
}
```

`agent_name` contains the agent's **nickname** (from `get_agent_nickname(conversation)`, which reads from the frozen `ai_profile_snapshot_json`). The widget displays this as the sender label above every AI message bubble. All `publish_chat_response` calls for AI messages — including the initial greeting — include this field.

**`identity_verification_offer: true`** is set when:
- `identity_type = "Public"` (visitor is unidentified), AND
- `fallback_used = True` (retrieval found nothing under public access)

When `true`, the `message` field contains the `PUBLIC_IDENTITY_FALLBACK` offer text. The widget renders an inline email + OTP form for the visitor to verify their identity. Desk users never see this offer.

**Human agent message payload** (same event, different `sender_type`):
```json
{
    "conversation_id": "ABC123DEF456",
    "status": "success",
    "response_type": "message",
    "sender_type": "Human Agent",
    "sender_name": "Sarah (Agent)",
    "message": "Hi, let me help you with that.",
    "answer": "Hi, let me help you with that.",
    "confidence": 1.0
}
```

**Category picker payload:**
```json
{
    "conversation_id": "ABC123DEF456",
    "status": "await_category",
    "response_type": "category_picker",
    "message": "Nice to meet you, Alex! To help direct your query, please select a topic from the options below.",
    "agent_name": "Aria",
    "categories": [
        { "category_code": "GENERAL-SUPPORT", "category_label": "General Support", "display_order": 1 }
    ]
}
```

`_send_category_picker` accepts an `is_internal` parameter. When `is_internal=True`, it filters categories to `visibility` = Internal or Both; when `is_internal=False` (public widget), it filters to External or Both.

If the filtered list is empty (no categories match the visibility filter for the channel), `_send_category_picker` returns `None` immediately — no message is sent and `await_category` intent is NOT set. The caller handles this by sending a plain "How can I help you today?" message instead.

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

### `nexus_escalation_alert`

Fired to human agents when a new escalation is created. Each eligible agent receives a personal realtime event (not a broadcast).

```json
{
    "conversation_id": "ABC123DEF456",
    "visitor_name": "John",
    "chat_category": "GENERAL-SUPPORT"
}
```

### `nexus_escalation_claimed`

Fired to all console users when an agent claims an escalated conversation.

```json
{
    "conversation_id": "ABC123DEF456",
    "claimed_by_agent": "agent@example.com",
    "claimed_by_nickname": "Sarah"
}
```

### Client subscription

```javascript
frappe.realtime.on("nexus_chat_response", function(data) {
    if (data.conversation_id !== my_conversation_id) return;

    hide_typing_indicator();

    if (data.status === "error") {
        show_error(data.error);
        return;
    }

    // visitor_message events are for the console panel only — ignore in visitor widget
    if (data.response_type === 'visitor_message') return;

    switch (data.response_type) {
        case "message":
            if (data.sender_type === "Human Agent") {
                render_agent_message(data.message, data.sender_name);
            } else {
                render_ai_message(data.message, data.confidence);
            }
            break;
        case "category_picker":
            render_category_picker(data.message, data.categories);
            break;
        case "message_held":
            render_system_message(data.message);  // amber italic
            break;
        case "agent_joined":
            append_system_message(data.message);  // yellow italic box
            break;
        case "escalation_resolved":
            render_system_message(data.message);
            unlock_input();
            break;
        case "conversation_closed":
            render_system_message(data.message);
            lock_input_permanently();
            break;
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
1. `visibility` — public widget shows External + Both; internal desk chat shows Internal + Both
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
| `visitor_email` | String | No | Set by widget after OTP email submission |
| `identity_verification_challenge` | String | No | OTP challenge token; upgrades identity type via resolver Step 2 |

The widget automatically injects `visitor_email` and `identity_verification_challenge` into every message payload when they are set in widget state (`S`). Both are cleared when a new conversation starts. All other fields (channel, context, identity snapshot, etc.) are re-enriched from the conversation document automatically and do not need to be re-sent.

**Response:**
```json
{
    "status": "processing",
    "conversation": "NLC-00001",
    "conversation_id": "ABC123DEF456"
}
```

---

### `get_available_categories_for_tenant`

```
Method : GET
Auth   : Desk users only
Args   : none
```

Returns all enabled chat categories for internal console use. Unlike `get_channel_categories`, this does not filter by channel or identity type — desk agents see every enabled category.

---

### `get_active_conversations`

```
Method : GET
Auth   : Desk users only (no allow_guest)
Args   : limit (default: 50)
```

Returns live conversations for the console. Behavior depends on the caller's role:

**Admin mode** (System Manager or no `can_handle_escalations` assignment):
- Returns conversations with status `Open`, `Responding`, `Escalated`, or `Waiting`
- Excludes `user_type=Desk User` (personal desk chats are not support conversations)
- Response: `{ conversations: [...], mode: "admin" }`

**Agent mode** (has active `Nexus User Profile Assignment` with `can_handle_escalations=1`, NOT System Manager):
- Returns ALL active external conversations: status `IN (Open, Responding, Escalated, Waiting)`
- Excludes `user_type=Desk User` (same as admin mode)
- The `assigned_categories` restriction is **not** applied to the query — agents see all categories
- Response: `{ conversations: [...], mode: "agent", agent, agent_nickname, assigned_categories }`

Both modes include `escalated_at` and `human_agent` fields per conversation.

---

### `get_conversation_detail`

```
Method : GET
Auth   : Desk users only
Args   : conversation_id (required)
```

Returns full conversation metadata and all messages (up to 100). Used by the Live Console when a conversation is opened.

Additional fields returned (beyond basic metadata):
- `escalated_at` — datetime when the conversation was escalated
- `human_agent` — Frappe user ID of the agent who claimed it
- `human_agent_nickname` — display name of the human agent

---

### Agent Console API (`api/agent_console.py`)

These endpoints are for human agents managing escalated conversations. All require a Frappe session with an active `Nexus User Profile Assignment` where `can_handle_escalations=1`.

#### `get_agent_context`
```
Method : GET / POST
Auth   : Desk users
```
Returns `{ is_agent, agent, nickname, categories[] }`. Used by the console on page load to detect agent mode and display the agent banner.

#### `claim_conversation`
```
Method : POST
Auth   : can_handle_escalations assignment (or System Manager)
Args   : conversation_id
```
Claims any active conversation (Open, Responding, Waiting, or Escalated). Sets `human_agent=session_user`, `escalation_status=Accepted`. Fires `nexus_escalation_claimed` realtime event so other agents see it as taken.

- If the conversation is not already `Escalated`: auto-escalates via `mark_escalated()`, then sends a System message "A support agent is joining this conversation to assist you." to the visitor's widget via `response_type: "agent_joined"` (rendered as a yellow italic system box, not an AI bubble).
- System Managers can claim without needing `can_handle_escalations` on their profile.

#### `agent_send_message`
```
Method : POST
Auth   : can_handle_escalations assignment
Args   : conversation_id, message
```
Stores the message as `sender_type="Human Agent"` and publishes it via `nexus_chat_response` (`sender_type="Human Agent"`, `sender_name=nickname`) so the visitor's widget displays a green agent bubble. `sender_agent` (Link to `Nexus AI Agent Profile`) is left blank — that field is for AI bot records only. Human agent identity is tracked via `conversation.human_agent` (Frappe user ID).

#### `resolve_escalation`
```
Method : POST
Auth   : System Manager or can_handle_escalations
Args   : conversation_id
```
Ends human handling. Sets `status=Responding`, `escalation_status=Resolved`, clears `human_agent`. Resolves all pending `Nexus Live Escalation` records. Sends a system message to the visitor and fires `response_type=escalation_resolved` so the widget unlocks the input.

#### `close_conversation_by_agent`
```
Method : POST
Auth   : System Manager or can_handle_escalations
Args   : conversation_id
```
Closes the conversation from the agent's side. Stores a farewell system message, sets `status=Closed`, fires `response_type=conversation_closed` to the visitor's widget.

---

## Start Chat Flow (Detailed)

The `start_chat` flow diverges for desk (internal) users and external visitors.

### Desk User Path

```
start_chat(payload) — DESK USER
│
├── 1. apply_session_user_context(payload)
│       Sets user_type: "Desk User"; attaches user context
│
├── 2. apply_tenant_context_to_payload(payload)
│
├── 3. resolve_behavior_for_internal_user(session_user)
│       → Nexus User Profile Assignment (active=1) → Nexus AI Agent Profile
│       Throws if no assignment and user is not System Manager
│
├── 4. If profile found: payload["agent"] = ai_profile_override.agent_name
│       (agent_name is the correct field on Nexus AI Agent Profile)
│       If no explicit agent: payload.visibility = "Internal"
│
├── 5. assign_agent(payload)
│       Priority: explicit agent → channel default_agent → role-based fallback
│       Throws "No AI agent available for desk chat" if nothing found
│
├── 6. create_conversation(payload, agent, ai_profile_override)
│       Creates Nexus Live Conversation, status=Open
│       Snapshots ai_profile_snapshot_json for consistent behavior
│
├── 7. update_conversation_assignment(conversation, agent) → status=Responding
│
├── 8. Resolve visitor_name from Frappe User record
│       frappe.get_value("User", session_user, "first_name") → first_name
│       conversation.visitor_name = first_name
│       (No name prompt is shown; name is resolved automatically for desk users)
│
├── If message provided:
│   ├── add_message(sender_type="User", message)
│   ├── _enqueue_ai_response(conversation_id, payload)
│   └── Return: { status: "processing", conversation_id, agent_code, agent_name }
│
└── If NO message (widget opened cold):
    ├── agent_nick = get_agent_nickname(conversation, agent)
    ├── If no chat_category:
    │       greeting = "Hi {first_name}! I'm {agent_nick}, your AI assistant. How can I help you today?"
    │       add_message(sender_type="AI Agent", message=greeting)  ← DB only, no realtime
    │       Return: { status: "ready", greeting: greeting, conversation_id, agent_code, agent_name }
    └── If chat_category selected:
            greeting = "Hi {first_name}! I'm {agent_nick}, your AI assistant. Please select a topic so I can assist you better."
            add_message(sender_type="AI Agent", message=greeting)  ← DB only, no realtime
            _send_category_picker(conversation, is_internal=True)
            Return: { status: "ready", greeting: greeting, conversation_id, agent_code, agent_name }
```

The greeting is returned in the HTTP response (not via realtime) to avoid a race condition
where the socket event arrives before the client has stored `conversation_id`.

### Visitor / Guest Path

```
start_chat(payload) — VISITOR / GUEST
│
├── 1. apply_session_user_context(payload)
│       Sets user_type: "Guest" | "Website User"
│
├── 2. If chat_category set: enforce_category_verification(payload)
│       Checks Nexus Identity Verification Challenge
│       If verified → sets payload.identity_registry
│
├── 3. apply_tenant_context_to_payload(payload)
│
├── 4. If chat_category:
│   ├── resolve_identity_type(payload)
│   │       Priority: trust_payload_identity → OTP challenge → registry blocked check
│   │           → Frappe session user type → api_scope → "Public"
│   ├── resolve_behavior_from_chat_category(category, identity_type, is_authenticated, payload)
│   │       Public: open_to_all route (empty identity_profiles) → knowledge_profile_names = []
│   │       Registered: registry → identity profiles ∩ route permitted profiles
│   │           → knowledge_profile_names (for matching identity_type)
│   │       Throws if no active route
│   ├── resolve_identity_registry_name(payload)
│   ├── resolve_identity_safeguard_access_categories(payload)
│   │       Reads from Nexus Identity Type (class-level cap, not registry)
│   │       Stored as identity_safeguard_access_json on conversation
│   └── knowledge_profile_names stored in payload for snapshot
│
├── 5. assign_agent(payload) → throws if none available
│
├── 6. create_conversation(payload, agent, ai_profile_override)
│       status=Open; snapshots ai_profile_snapshot_json
│
├── 7. update_conversation_assignment(conversation, agent) → status=Responding
│
├── 8. If message provided: add_message(sender_type="Visitor", message)
│
├── 9. Send greeting via realtime:
│       agent_nick = get_agent_nickname(conversation, agent)
│       publish_chat_response → response_type="message", agent_name=agent_nick
│       message: "Hi! I'm {agent_nick}, your AI assistant. It's great to have you here!"
│
├── 10a. If no visitor_name (always true for public visitors who haven't provided a name):
│           Send name prompt via realtime → response_type="message"
│           message: "Before we get started, could I get your name please?"
│           Set conversation.intent = "await_name"
│           Return: { status: "awaiting_name", conversation_id, ... }
│
├── 10b. Elif no chat_category selected:
│           result = _send_category_picker(conversation, is_internal=False)
│           If result is None (no External/Both categories configured):
│               publish "How can I help you today?" → response_type="message"
│               Return: { status: "ready", conversation_id, ... }
│           Else:
│               → response_type="category_picker"
│               Set conversation.intent = "await_category"
│               Return: { status: "await_category", conversation_id, ... }
│
└── 10c. Elif chat_category already provided:
            If message: _enqueue_ai_response()
            Else: publish "How can I help you today?" → response_type="message"
            Return: { status: "processing", conversation_id, ... }
```

---

## Continue Chat Flow (Detailed)

```
send_chat_message(conversation_id, payload)
│
├── 1. apply_session_user_context(payload)
│
├── 2. get_conversation(conversation_id)
│
├── 3. If conversation.status == "Closed":
│       Return: { status: "closed", message: "This conversation is closed..." }
│
├── 4. If conversation.status == "Escalated":  ← DOES NOT invoke AI
│       If message:
│           add_message(sender_type="Visitor"|"User", message)
│           publish_chat_response → response_type="visitor_message"
│               (pushes visitor message to the agent panel)
│           If conversation.human_agent is NOT set (unclaimed escalation):
│               publish_chat_response → response_type="message_held"
│                   message: "Your message has been received. Our agent will respond shortly."
│           (If human_agent IS set, message is stored and forwarded silently — no acknowledgment)
│       Return: { status: "escalated", conversation_id }
│
├── 5. enrich_payload_from_conversation(payload, conversation)
│       Re-fills: tenant, business_unit, project, channel, chat_category,
│                 identity_type, identity_registry, context, sub_context,
│                 entity_type, entity, topic
│       Restores identity_safeguard_access_categories from conversation JSON
│
├── intent = conversation.intent  (set during visitor onboarding)
│
├── 6. If intent == "await_category" AND message starts with "__cat__:":
│       Parse category_code from "__cat__:CATEGORY_CODE"
│       Update conversation: chat_category=category_code, intent=""
│       add_message(sender_type="AI Agent", ack message)
│       publish_chat_response → response_type="message"
│       Return: { status: "category_selected", conversation_id }
│
├── 7. add_message(sender_type="Visitor"|"User", message)
│       (for all non-category-click cases)
│
├── 8. If intent == "await_name":
│       Set conversation.visitor_name = message (max 100 chars), intent=""
│       result = _send_category_picker(conversation, greeting_name=visitor_name)
│       If result is None (no External/Both categories configured):
│           publish "Nice to meet you, {name}! How can I help you today?" via realtime
│               → response_type="message" (sent directly, not via background job)
│       Else:
│           → publish_chat_response → response_type="category_picker"
│           Set conversation.intent = "await_category"
│       Return: { status: "name_collected", conversation_id }
│
├── 9. If intent == "await_close_confirm":
│       If _is_no_more_help(message):  ← "no", "nope", "all done", "bye", etc.
│           _close_conversation_gracefully() → response_type="conversation_closed"
│           Return: { status: "closed", conversation_id }
│       Else (visitor still has questions):
│           Clear intent, _enqueue_ai_response()
│           Return: { status: "processing", conversation_id }
│
├── 10. If _is_closing_message(message):  ← "thanks", "bye", "all done", etc.
│       add_message(sender_type="AI Agent", close_prompt)
│       publish_chat_response → response_type="message"
│           message: "I'm glad I could help! Before we wrap up, is there anything else?"
│       Set conversation.intent = "await_close_confirm"
│       Return: { status: "close_pending", conversation_id }
│
└── 11. _enqueue_ai_response(conversation_id, payload)
        Return: { status: "processing", conversation_id }
```

### Visitor Onboarding State Machine

When a visitor starts without pre-selecting a category, `continue_live_chat` drives them through an onboarding sequence using `conversation.intent`:

```
(start) → greeting sent ("Hi! I'm {agent_nick}, your AI assistant. It's great to have you here!")
              │
              └── visitor_name not set? (always true for new public visitors)
                      YES → name prompt sent → intent="await_name"
                              visitor sends name → visitor_name stored
                                  → _send_category_picker() called
                                      If categories exist:
                                          → "Nice to meet you, {name}!..." + category picker shown
                                          → intent="await_category"
                                          → visitor sends "__cat__:CODE" → category_code set, intent cleared
                                          → normal AI flow begins
                                      If no External/Both categories (returns None):
                                          → "Nice to meet you, {name}! How can I help you today?" sent directly
                                          → intent cleared; normal AI flow begins immediately
                      (NO branch removed — name collection is always on for public visitors)
```

**Zero-category configuration:** If no External or Both visibility categories exist for the channel, visitors skip category selection entirely and go straight to AI chat. The system works cleanly with zero category configuration.

Category selection messages use the `__cat__:CATEGORY_CODE` format so the widget can distinguish transparent system messages from real visitor input. They are NOT stored as visitor messages in the conversation history.

### Closing Signal Detection

`_is_closing_message(message)` matches short messages (≤80 chars) against a phrase set:
`bye`, `goodbye`, `thank you`, `thanks`, `all done`, `that's all`, `nothing else`, `i'm done`, etc.

When matched, the AI asks if the visitor needs anything else before closing (`intent="await_close_confirm"`).
If the visitor confirms they're done (`_is_no_more_help`), the conversation is closed gracefully with a farewell message.

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
│   │       Packages: name, knowledge_profile_names, behavior_prompt, tone,
│   │                 response_style, welcome_message, fallback_message,
│   │                 do_not_answer_rules, confidence_threshold,
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
│           - ai_profile.knowledge_profile_names → union of all Knowledge Profile policies
│           - intersected with identity_safeguard_access_categories (Identity Type class cap)
│           - force_public_only=True when no named profile and identity is "Public"/Guest
│           - System Manager → all enabled policies
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
│       Escalation fires ONLY when ALL THREE conditions are true:
│           user_requested_human = True      (set by ACTION:ESCALATE in router)
│       AND escalation_enabled = True        (on the resolved Nexus AI Agent Profile)
│       AND category_allows_escalation = True (Nexus Chat Category.enable_escalation = 1)
│
│       The category flag lets admins disable human escalation per-category without
│       touching the AI profile, e.g. a simple FAQ category can block escalation
│       even if the profile has escalation_enabled.
│
│       Low confidence and RAG fallback do NOT trigger escalation.
│       Escalation is a deliberate user action, not an automatic system response.
│
│       If triggered:
│           create_escalation(conversation, reason="User Requested Human",
│                             from_agent, confidence)
│               → creates Nexus Live Escalation
│               → sets conversation.status = "Escalated"
│               → sets conversation.escalation_status = "Pending"
│               → publish_escalation_alert fires per-agent realtime alerts
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

Behavior is resolved once per background job. The conversation's stored profile snapshot is
used for all follow-up turns to keep tone, fallback, and knowledge access consistent throughout
the conversation.

```
Priority 1 — Stored profile snapshot (follow-up turns)
    conversation.ai_profile_snapshot_json → behavior dict + knowledge_profile_names
    Used whenever the conversation already has an assigned profile

Priority 2 — Internal desk user knowledge resolution
    session_user → Nexus Identity Registry (registry.user)
    → active identity profiles
    → identity_mappings where identity_type = "Internal" | "Admin"
    → knowledge_profile_names
    Hard error if no registry and user is not System Manager

Priority 3 — Chat category route (external visitors)
    payload.chat_category + resolved identity_type + payload
    → Nexus Category Identity Route (enabled=1)
    → ai_agent_profile (behavior)
    → permitted identity_profiles intersected with visitor's profiles
    → knowledge_profile_names

Priority 4 — Agent behavior (legacy)
    agent → Nexus AI Agent Profile (linked via agent field)
    knowledge_profile_names = []
    Used only when no category is present
```

---

## Identity Resolution

Identity type is determined before route selection. Resolution stops at the first match.

```
resolve_identity_type(payload)
│
├── 1. trust_payload_identity = True + identity_type in payload + identity_type enabled
│       → use explicit identity_type directly
│       (Server-to-server only. Never trust from a browser.)
│
├── 2. Verified OTP challenge
│       identity_verification_challenge token in payload?
│       → get_verified_challenge() → challenge.status = "Verified"
│       → return challenge.resolved_identity_type
│
├── 3. Nexus Identity Registry lookup  ← NEW (precedes Frappe session)
│       _find_identity_registry(payload):
│         a. Verified OTP challenge → registry on challenge doc
│         b. Frappe session user → registry where user = session_user
│         c. trust_visitor_email = True + email → registry by email
│       Registry found + verification_status = "Verified"?
│       → walk active identity profiles → return first identity_type from mappings
│       (Works for external websites — not tied to Frappe portal sessions)
│
├── 4. Frappe session fallback
│       frappe.session.user != "Guest"?
│       Website User → "Customer"
│       System User + System Manager role → "Admin"
│       System User → "Internal"
│
├── 5. api_scope field
│       api_scope = "partner" → "Partner"
│       api_scope = "prospect" → "Prospect"
│
└── 6. Default floor: "Public"
        Always reached when nothing above matched.
        Public visitors access only Public-tagged knowledge.
```

**Public is the floor, never an error.** Unidentified visitors always get Public access.

**Registry-before-Frappe-session** ensures external website visitors (no Frappe session cookie) with a registry entry are correctly identified — not silently resolved as Guest.

If a `Nexus Identity Registry` record exists:
- `resolve_identity_safeguard_access_categories(payload)` reads caps from `Nexus Identity Type`
  (cap is class-level, not per-person — all holders of a class are uniformly capped)
- Stored on the conversation as `identity_safeguard_access_json`
- Restored on each subsequent turn and passed to `resolve_allowed_policies`

### Identity Verification Offer

When `identity_type = "Public"` AND `fallback_used = True` in the AI response:
- `live_chat_service` replaces the fallback message with `PUBLIC_IDENTITY_FALLBACK` text
- Publishes `identity_verification_offer: true` in the realtime event
- Widget (non-desk only) renders an inline email + OTP form
- On success: `S.identity_verification_challenge` stored; injected into all subsequent message payloads
- `identity_resolver` Step 2 upgrades identity for those messages

See `docs/identity-resolution.md` for the full OTP API reference.

---

## Access Policy Resolution

```
resolve_allowed_policies({
    channel,
    user: { roles },
    force_public_only,
    identity_type,
    identity_safeguard_access_categories,
    ai_profile: {
        name,
        knowledge_profile_names,   ← list of Knowledge Profile names
        identity_type
    }
})
→ { allowed_access_policies: ["Public", "Customer Support", ...] }
```

`force_public_only = True` when:
- `not ai_profile.name` AND (identity_type == "Public" OR user_type == "Guest")

When a routed AI profile exists, Public visitors use that profile's knowledge access and are
NOT force-public-only. Only truly unrouted public requests are capped to `["Public"]`.

Resolution with `knowledge_profile_names`:
```
profile_policies = union of all policies from all Knowledge Profiles
cap = identity_safeguard → their access categories → their policies
allowed = profile_policies ∩ cap  (or profile_policies if no cap)
```

---

## Conversation Lifecycle

```
Status            Meaning
───────────────────────────────────────────────────────
Open              Conversation created, agent assigned, awaiting first AI response
Responding        AI agent is currently processing a message
Escalated         User requested human agent; AI is bypassed until resolved
Closed            Conversation ended (by visitor, agent, or idle timeout)

escalation_status (independent field on Nexus Live Conversation):
(empty)           No escalation
Pending           Escalation created; no human agent has claimed it yet
Accepted          A human agent has claimed the conversation (human_agent field set)
Resolved          Human agent resolved the escalation; AI resumes
```

Status transitions:

```
create_conversation()            → Open
update_conversation_assignment() → Responding
_process_ai_response() starts   → Nexus AI Agent: status=Responding
_process_ai_response() ends     → Nexus AI Agent: status=Waiting
user_requested_human = True     → Escalated; escalation_status=Pending
claim_conversation()             → escalation_status=Accepted; human_agent set
resolve_escalation()             → Responding; escalation_status=Resolved; human_agent cleared
_close_conversation_gracefully() → Closed
close_idle_conversations()       → Closed (scheduled job; idle timeout from Nexus Settings)
```

Note: The conversation `status` field does NOT use a "Waiting" state. "Waiting" is only an
internal status on the `Nexus AI Agent` (the AI worker), not on the conversation itself.

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

Escalation is triggered **only** when the user explicitly requests a human agent. Three conditions must all be true:

| Condition | How it is set |
|---|---|
| `user_requested_human = True` | Router LLM returns `ACTION:ESCALATE` → `answer_query` sets flag |
| `escalation_enabled = True` | On the resolved `Nexus AI Agent Profile` |
| `enable_escalation = 1` | On the `Nexus Chat Category` (opt-in per category) |

```
User says: "Can I speak to a human?" or "Connect me to support"
    │
    ▼
Router LLM matches "Human Agent Request" intent → ACTION:ESCALATE
    │
    ▼
answer_query returns: { user_requested_human: True, answer: "<template response>" }
    │
    ▼
live_chat_service checks ALL THREE conditions
    │
    ▼
create_escalation(reason="User Requested Human")
    → Nexus Live Escalation created
    → conversation.status = "Escalated"; escalation_status = "Pending"
    → publish_escalation_alert → per-agent realtime notifications
```

**Low confidence and RAG fallback do not trigger escalation.** If the AI cannot find an answer, it responds warmly and invites a follow-up. The user chooses whether to escalate.

Once escalated, `continue_live_chat` stores visitor messages and sends them to the agent panel via `response_type="visitor_message"`, but does not invoke the AI. The human agent responds via `agent_send_message`. When done, the agent calls `resolve_escalation` (AI resumes) or `close_conversation_by_agent`.

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
| `Nexus Live Message` | One record per message turn (visitor + AI + human agent) |
| `Nexus AI Agent` | AI agent record; status toggled Idle → Responding → Waiting |
| `Nexus AI Agent Profile` | Behavior config: tone, fallback, thresholds, intent overrides. **Not knowledge access.** |
| `Nexus Profile Intent Override` | Profile-level overrides for global intent handlers (child table on profile) |
| `Nexus Intent Handler` | Global intent handler definitions (escalation, predefined answers) |
| `Nexus Chat Category` | Visitor-selectable category; drives routing; `enable_escalation` flag controls human escalation per category |
| `Nexus Category Identity Route` | Maps channel + category → AI Agent Profile + permitted Identity Profiles |
| `Nexus Identity Profile` | Maps identity types to Knowledge Profiles; assigned to people via registry |
| `Nexus Identity Registry` | Person record; holds assigned Identity Profiles; `user` field links desk users |
| `Nexus Identity Type` | Identity class; `safeguard_access_categories` is the class-level access cap |
| `Nexus Identity Verification Challenge` | OTP/verification record per visitor+category session |
| `Nexus Live Escalation` | Escalation record created when user requests human agent |
| `Nexus Escalation Rule` | Defines escalation target by agent role |
| `Nexus Agent Queue` | Human agent queue for escalations |
| `Nexus Live Channel` | Channel configuration (e.g., WEBSITE-CHAT) |
| `Nexus User Profile Assignment` | Escalation config only: `can_handle_escalations=1` grants human agent mode; `escalation_categories` scopes which categories the agent sees |

---

## Chat Widget UX

### Default Panel Size

`400px × 580px` (width × height). A maximize button in the header toggles the `.ncw-maximised` class, expanding the panel to `50vw × 80vh`. The icon swaps between expand and collapse states.

### Font Size Cycling

An `A` button in the header cycles through `[13.5, 16, 18, 20]` px. The current size is applied as the CSS custom property `--ncw-fs` on `#ncw-root` so all content text scales uniformly. The selection is persisted in `localStorage` under the key `ncw_fs2`.

### Typewriter Effect

All AI agent messages — including the first greeting — type out word-by-word with a blinking `|` cursor. Base speed adapts to message length (80–140 ms/word) with ±30 ms jitter per word and a +180 ms pause after sentence endings. Markdown is rendered on completion after the last word appears.

### Agent Sender Label

The agent's nickname (`agent_name` from the realtime event) is displayed in blue (`#2158c7`) above each AI message bubble. Human agent messages show the agent's display name in green (`#276749`). The header title shows the agent's nickname and the subtitle reads `"AI Assistant · Online"` when the chat opens.

---

## Service Layer Map

| Module | Responsibility |
|---|---|
| `api/live.py` | HTTP endpoints; payload parsing; delegates to services |
| `api/agent_console.py` | Human agent console actions: get_agent_context, claim_conversation, agent_send_message, resolve_escalation, close_conversation_by_agent |
| `services/live_chat_service.py` | Start/continue chat; visitor onboarding (greeting/name/category); closing signals; idle timeout; enqueue background job; build AI payload |
| `services/intent_handler_service.py` | Load and merge global intent handlers with profile overrides |
| `services/chat_realtime.py` | `publish_realtime` wrappers for response, typing, error, escalation alert/claimed events |
| `services/conversation_service.py` | Conversation and message CRUD |
| `services/agent_router.py` | Agent selection logic |
| `services/agent_service.py` | Agent status management; profile loading |
| `services/profile_resolver.py` | Behavior resolution from conversation, internal user, or category |
| `services/identity_resolver.py` | Identity type and registry resolution |
| `services/identity_verification.py` | OTP/challenge enforcement for categories that require it |
| `services/escalation_service.py` | Escalation rule lookup, escalation creation, and escalation alert publishing |
| `services/conversation_context_service.py` | Chat history and follow-up query continuity |
| `digitz_ai_nexus.services.answer_service` | Core routing, retrieval, and LLM answer generation (external) |

---

## Nexus Live Console

The desk-facing conversation monitor at `/nexus-live-console`.

### Mode Detection

On `init()`, calls `agent_console.get_agent_context`. If `is_agent=true` the console enters **agent mode**: an agent banner shows the signed-in agent's nickname and assigned categories, and the banner text reads "Showing all active external conversations". Otherwise, **admin mode** is used.

In both modes, the full status dropdown is available (default: "All Statuses"). The status filter is no longer locked to "Escalated" in agent mode.

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
- Claim section in the conversation panel:
  - Unclaimed + agent mode → "Take this conversation" button
  - Claimed by self → "You are handling this conversation"
  - Claimed by other → "Taken by [nickname]"; input disabled
  - System Manager → no claim needed; input always enabled

### Idle Timeout

`close_idle_conversations()` is a scheduled job that closes conversations idle longer than `Nexus Settings.chat_idle_timeout_minutes` (default: 10 minutes). It runs across `Open`, `Responding`, and `Escalated` conversations, sends a farewell system message, and fires `response_type=conversation_closed` to the visitor.
