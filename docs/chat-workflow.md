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
    │      ├── build payload
    │      ├── answer_query()  ← digitz_ai_nexus core
    │      ├── persist AI message
    │      ├── check escalation
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
| `message` | String | Yes | The visitor's first message |
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
| `user_requested_human` | Boolean | No | Triggers escalation regardless of confidence |

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
| `message` | String | Yes | |
| `user_requested_human` | Boolean | No | Triggers escalation |

All other fields (channel, tenant, context, etc.) are re-enriched from the conversation document automatically and do not need to be re-sent.

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

**Response:**
```json
{
    "conversations": [
        {
            "name": "NLC-00001",
            "conversation_id": "ABC123DEF456",
            "status": "Responding",
            "escalation_status": "None",
            "assigned_agent": "PUBLIC-AI-ASSISTANT",
            "channel": "WEBSITE-CHAT",
            "chat_category": "GENERAL-SUPPORT",
            "resolved_identity_type": "Public",
            "user_type": "Guest",
            "visitor_name": null,
            "visitor_email": null,
            "last_message": "Tell me about pricing",
            "last_response": "Our pricing starts at...",
            "confidence": 0.87,
            "started_on": "2026-06-07 10:23:00"
        }
    ]
}
```

---

### `get_conversation_detail`

```
Method : GET
Auth   : Desk users only
Args   : conversation_id (required)
```

Returns full conversation metadata and all messages. Used by the Nexus Live Console when a conversation is opened.

**Response:**
```json
{
    "conversation": {
        "name": "NLC-00001",
        "conversation_id": "ABC123DEF456",
        "status": "Responding",
        "escalation_status": "None",
        "assigned_agent": "PUBLIC-AI-ASSISTANT",
        "channel": "WEBSITE-CHAT",
        "chat_category": "GENERAL-SUPPORT",
        "resolved_identity_type": "Public",
        "user_type": "Guest",
        "visitor_name": null,
        "visitor_email": null,
        "started_on": "2026-06-07 10:23:00"
    },
    "messages": [
        {
            "name": "NLM-00001",
            "sender_type": "Visitor",
            "sender_agent": null,
            "message": "Hello",
            "confidence": null,
            "message_time": "2026-06-07 10:23:01"
        },
        {
            "name": "NLM-00002",
            "sender_type": "AI Agent",
            "sender_agent": "PUBLIC-AI-ASSISTANT",
            "message": "Hi! How can I help you today?",
            "confidence": 0.91,
            "message_time": "2026-06-07 10:23:04"
        }
    ]
}
```

---

## Start Chat Flow (Detailed)

```
start_chat(payload)
│
├── 1. Validate: message required
│
├── 2. apply_session_user_context(payload)
│       Sets user_type: "Guest" | "Website User" | "System User"
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
│   └── resolve_allowed_policies(...)
│           Computes the set of Nexus Access Policies the conversation can retrieve from:
│           - ai_profile access categories → their policies
│           - intersected with identity_safeguard_access_categories (if set)
│           - force_public_only=True when no named profile or identity is "Public"/Guest
│
├── 7. answer_query(core_payload)  ← digitz_ai_nexus core
│       Response sentence limit: 6 (CHAT_RESPONSE_SENTENCE_LIMIT)
│       Returns: { answer, confidence, sources, retrieval_debug }
│
├── 8. Fallback resolution
│       If answer is empty → use behavior.fallback_message or DEFAULT_FALLBACK_ANSWER
│       If answer is the generic default but profile has a custom fallback → use custom
│
├── 9. add_message(conversation, sender_type="AI Agent", message=answer, confidence, sources)
│
├── 10. set_agent_status(agent, "Waiting")
│
├── 11. Escalation check
│       should_escalate() returns True when ANY of:
│           - user_requested_human = True
│           - no_knowledge (answer is fallback message)
│           - confidence < confidence_threshold (default: 0.65)
│       AND escalation_enabled = True on the behavior
│
│       If escalation triggered:
│           create_escalation(conversation, reason, from_agent, confidence)
│               reason: "Low Confidence" | "No Approved Knowledge"
│               → creates Nexus Live Escalation
│               → sets conversation.status = "Escalated"
│               → sets conversation.escalation_status = "Pending"
│
└── 12. publish_chat_response(conversation_id, result)
        → fires nexus_chat_response event with full result payload
```

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
Escalated         Escalation triggered; conversation routed to human queue
Closed            Conversation ended

escalation_status (independent field):
None              No escalation
Pending           Escalation created, not yet resolved
Resolved          Human agent resolved the escalation
Rejected          Escalation was rejected
```

Status transitions:

```
create_conversation()           → Open
update_conversation_assignment() → Responding
_process_ai_response() starts  → agent status: Responding
_process_ai_response() ends    → agent status: Waiting
should_escalate() = True       → Escalated / escalation_status: Pending
close_conversation()            → Closed
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

## Escalation Rules

Escalation is triggered by `should_escalate()`:

```python
def should_escalate(confidence, no_knowledge, user_requested_human,
                    escalation_enabled, threshold):
    if not escalation_enabled:
        return False
    if user_requested_human:
        return True       # Always escalate on explicit request
    if no_knowledge:
        return True       # Answer is the fallback message
    if confidence < threshold:
        return True       # Below confidence threshold
    return False
```

Default confidence threshold: `0.65` (overridden by `behavior.confidence_threshold`).

Escalation lookup (`create_escalation`):
1. Find `Nexus Escalation Rule` where `agent_role` matches the assigned agent's role and `enabled = 1`
2. Find target from rule: `target_agent` or `target_queue`
3. If target is a queue: find an available human agent via `Nexus Queue Assignment`
4. Create `Nexus Live Escalation` record
5. Mark conversation `Escalated` / `escalation_status = Pending`

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
| `DEFAULT_FALLBACK_ANSWER` | `"I do not have enough approved knowledge to answer this."` | Used when no answer or empty answer is returned |

---

## DocTypes Involved

| DocType | Role |
|---|---|
| `Nexus Live Conversation` | One record per conversation session |
| `Nexus Live Message` | One record per message turn (visitor + AI) |
| `Nexus Live Agent` | Agent record; status toggled Idle → Responding → Waiting |
| `Nexus AI Agent Profile` | Behavior, access categories, thresholds |
| `Nexus Chat Category` | Visitor-selectable category; drives routing |
| `Nexus Category Identity Route` | Maps channel + category + identity_type → AI Agent Profile |
| `Nexus Identity Registry` | Registered visitor record; holds safe guard access categories |
| `Nexus Identity Verification Challenge` | OTP/verification record per visitor+category session |
| `Nexus Live Escalation` | Escalation record created when AI cannot resolve |
| `Nexus Escalation Rule` | Defines escalation target by agent role |
| `Nexus Agent Queue` | Human agent queue for escalations |
| `Nexus Live Channel` | Channel configuration (e.g., WEBSITE-CHAT) |

---

## Service Layer Map

| Module | Responsibility |
|---|---|
| `api/live.py` | HTTP endpoints; payload parsing; delegates to services |
| `services/live_chat_service.py` | Start/continue chat; enqueue background job; build AI payload |
| `services/chat_realtime.py` | `publish_realtime` wrappers for response, typing, error events |
| `services/conversation_service.py` | Conversation and message CRUD |
| `services/agent_router.py` | Agent selection logic |
| `services/agent_service.py` | Agent status management; profile loading |
| `services/profile_resolver.py` | Behavior resolution from conversation, internal user, or category |
| `services/identity_resolver.py` | Identity type and registry resolution |
| `services/identity_verification.py` | OTP/challenge enforcement for categories that require it |
| `services/escalation_service.py` | Escalation rule lookup and escalation creation |
| `services/conversation_context_service.py` | Chat history and follow-up query continuity |
| `digitz_ai_nexus.services.answer_service` | Core retrieval and LLM answer generation (external) |

---

## Nexus Live Console

The desk-facing conversation monitor at `/nexus-live-console`.

- Loads active conversations via `get_active_conversations`
- Opens a conversation → loads full message thread via `get_conversation_detail`
- Subscribes to `nexus_chat_response` and `nexus_chat_typing` for real-time updates
- Sends messages as a desk user via `send_chat_message`
- Auto-refreshes the conversation list every 15 seconds and after every realtime event
- Desk user messages are stored as `sender_type = "User"` (not Visitor)
