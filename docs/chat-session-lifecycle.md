# Chat Session Lifecycle

User stories, DocType references, and function calls for the chat startup and messaging flow.

---

## User Story 1 — Visitor Opens Chat and Sees Categories

**Story:** A visitor lands on the website, opens the chat widget, and sees a list of available purpose-specific categories (e.g. "Product Enquiry", "Demo Guidance").

**Function call:**

```
GET api/method/digitz_ai_nexus_live.api.live.get_channel_categories
    Args: channel, visitor_email (optional)
```

**What it does:**
- Looks up active `Nexus Chat Category` records for the given channel
- Filters by `visibility` field (External or Both) for guest/public visitors; Internal-only categories are excluded
- Filters out categories that have no enabled `Nexus Category Identity Route` for the visitor's identity type

**DocTypes read:**

| DocType | Why |
|---|---|
| `Nexus Chat Category` | Source of categories shown to the visitor |
| `Nexus Category Identity Route` | Confirms an active route exists before showing the category |

**Response:**
```json
{
    "channel": "WEBSITE-CHAT",
    "is_authenticated": false,
    "identity_type": "Public",
    "categories": [
        {
            "name": "PRODUCT-ENQUIRY",
            "category_code": "PRODUCT-ENQUIRY",
            "category_label": "Product Enquiry",
            "display_order": 1
        }
    ]
}
```

---

## User Story 2 — Visitor Opens Chat (Conversation Initialises)

**Story:** Visitor opens the chat widget. A conversation is created, a greeting appears, and the system guides the visitor through a short onboarding sequence before routing their question to the AI.

**Function call:**

```
POST api/method/digitz_ai_nexus_live.api.live.start_chat
    Body: { channel, chat_category (optional), visitor_name (optional), message (optional), ... }
```

`message` is optional. The chat initialises immediately; the visitor's first question can be provided now or typed after onboarding.

**Step-by-step inside `start_chat` (visitor path):**

```
start_chat(payload)
│
├── 1. apply_session_user_context(payload)
│       Sets user_type: "Guest" | "Website User"
│
├── 2. If chat_category: enforce_category_verification(payload)
│       Checks Nexus Identity Verification Challenge
│       If verified → sets payload.identity_registry
│
├── 3. apply_tenant_context_to_payload(payload)
│
├── 4. If chat_category:
│   ├── resolve_identity_type(payload)
│   │       Priority: explicit → OTP challenge → auth role → "Public"
│   ├── resolve_behavior_from_chat_category(category, identity_type, is_authenticated)
│   │       → Nexus Category Identity Route → Nexus AI Agent Profile
│   │       Throws if no active route found
│   ├── resolve_identity_registry_name(payload)
│   └── resolve_identity_safeguard_access_categories(payload)
│
├── 5. assign_agent(payload)
│
├── 6. create_conversation(payload, agent, ai_profile)
│       Creates: Nexus Live Conversation
│         - status = "Open"
│         - conversation_id = unique hex string (e.g. "ABC123DEF456")
│         - Snapshots ai_profile_snapshot_json for consistent behavior
│
├── 7. update_conversation_assignment(conversation, agent) → status = "Responding"
│
├── 8. If message: add_message(sender_type="Visitor", message)
│
├── 9. Send greeting via realtime:
│       publish nexus_chat_response → response_type="message"
│       "Hello! Welcome. I'm your AI assistant and I'm here to help you today."
│
├── 10a. If behavior.collect_visitor_name AND no visitor_name:
│           Publish name prompt → response_type="message"
│           Set conversation.intent = "await_name"
│           Return: { status: "awaiting_name", conversation_id, ... }
│
├── 10b. Elif no chat_category:
│           _send_category_picker() → response_type="category_picker"
│           Set conversation.intent = "await_category"
│           Return: { status: "await_category", conversation_id, ... }
│
└── 10c. Elif chat_category provided:
            If message: _enqueue_ai_response() (background job)
            Else: publish "How can I help you today?" → response_type="message"
            Return: { status: "processing", conversation_id, ... }
```

**Visitor onboarding sequence (no pre-selected category):**

```
Widget opens → greeting sent
                    │
                    ├── collect_visitor_name enabled? YES → "Could I get your name?"
                    │                                         visitor replies → name stored
                    │                                         → show category picker
                    └── collect_visitor_name disabled? → show category picker immediately
                                                             visitor taps category → AI ready
```

**DocTypes written/read:**

| DocType | Action | Why |
|---|---|---|
| `Nexus Live Conversation` | Created | One record per chat session; holds conversation_id |
| `Nexus Live Message` | Created | Greeting + any initial visitor message |
| `Nexus AI Agent` | Read + status set | AI agent assigned to this conversation |
| `Nexus Chat Category` | Read | Validates category and loads routing config |
| `Nexus Category Identity Route` | Read | Maps category + channel → AI Agent Profile + permitted Identity Profiles |
| `Nexus AI Agent Profile` | Read | Determines behavior (tone, fallback, thresholds). Not knowledge access. Template only. |
| `Nexus AI Agent Profile Instance` | Created | Runtime instance created from the profile template; holds the session nickname |
| `Nexus Identity Profile` | Read | Maps identity types to Knowledge Profiles for the person |
| `Nexus Identity Registry` | Read | Person record; finds active identity profiles for the visitor/user |
| `Nexus Identity Type` | Read | Loads safeguard access categories (class-level access cap) |
| `Nexus Identity Verification Challenge` | Read | Checks if visitor passed OTP for this category |
| `Nexus Tenant Configuration` | Read | Fills default tenant, channel, business_unit |

**conversation_id:** Generated as a random hex string at conversation creation time. It is not a Frappe autoname — it is a separate field stored on `Nexus Live Conversation` alongside the document name (`NLC-00001`). The client receives it in the response and must include it in all follow-up calls.

**Possible response statuses:**

| `status` | Meaning | Client action |
|---|---|---|
| `awaiting_name` | System waiting for visitor's name | Show name input |
| `await_category` | Category picker displayed | Show category selection UI |
| `processing` | AI is generating response (background job) | Show typing indicator |

```json
{
    "status": "await_category",
    "conversation": "NLC-00001",
    "conversation_id": "ABC123DEF456",
    "agent": "PUBLIC-AI-ASSISTANT",
    "agent_code": "PUBLIC-AI-ASSISTANT",
    "agent_name": "Aria",
    "agent_instance": "NAAPI-2026-00001"
}
```

`agent_name` is the randomly-chosen nickname for this session (from the profile's nickname pool).
The chat widget uses it as the header title. `agent_instance` is the `Nexus AI Agent Profile Instance` name.

---

## User Story 3 — AI Answer Arrives in the Browser

**Story:** The visitor sees a typing indicator, then the AI answer appears — without the page reloading or the browser polling.

**This happens in the background worker:**

```
_process_ai_response(conversation_id, payload_json)
│
├── 1. Load Nexus Live Conversation
├── 2. Load Nexus Live Agent
│
├── 3. _resolve_behavior(payload, conversation, agent)
│       Priority:
│         a) ai_profile_snapshot_json on conversation (behavior + knowledge_profile_names frozen at start)
│         b) Internal user's Nexus Identity Registry → Identity Profiles → knowledge_profile_names
│         c) chat_category → Nexus Category Identity Route → AI Agent Profile + knowledge_profile_names
│         d) Agent's own profile (legacy path, no knowledge profiles)
│
├── 4. set_agent_status(agent, "Responding")
│       Updates: Nexus Live Agent
│
├── 5. publish_chat_typing(conversation_id)
│       Fires Socket.io event: nexus_chat_typing
│       → Browser shows typing indicator
│
├── 6. build_core_chat_payload(payload, conversation, agent, behavior)
│   ├── build_chat_continuity_payload()     — detects follow-up, builds conversation_context
│   ├── build_chat_history()                — loads last 20 Nexus Live Message records
│   ├── _build_ai_profile_dict(behavior)    — packages tone, fallback, rules, thresholds
│   ├── resolve_intents_for_profile(name)   — merges global intent handlers + profile overrides
│   └── resolve_allowed_policies(...)       — computes final allowed access policies
│           = union of knowledge_profile_names policies ∩ Identity Type safeguard cap
│           = ["Public"] when force_public_only = True
│           = all policies when System Manager session
│
├── 7. answer_query(core_payload)  ← digitz_ai_nexus core
│   │
│   ├── Length Guard (chat mode)
│   │       Message > 500 chars → LLM nudges user to shorten; return immediately
│   │
│   ├── Intent Router (chat mode)
│   │       LLM receives: user message + conversation context + resolved intent handlers
│   │       │
│   │       ├── ACTION:ESCALATE
│   │       │       → answer with intent handler's response_template
│   │       │       → user_requested_human: True in response
│   │       │
│   │       ├── ACTION:PREDEFINED:<name>
│   │       │       → answer with handler's response_template
│   │       │
│   │       ├── ACTION:DECLINED:<name>
│   │       │       → answer with profile's decline_response
│   │       │
│   │       ├── Conversational
│   │       │       → LLM generates 1-2 sentence social response
│   │       │
│   │       └── ROUTE_TO_KNOWLEDGE → RAG pipeline
│   │
│   └── RAG pipeline (if knowledge_seeking)
│           → see retrieval-and-answer.md
│           Chat fallback: LLM Host generates warm response, no facts, no "connect with team"
│
├── 8. Fallback safety net
│       Empty answer → use behavior.fallback_message or default fallback
│
├── 9. add_message(conversation, sender_type="AI Agent", message, confidence, sources)
│       Creates: Nexus Live Message
│
├── 10. set_agent_status(agent, "Waiting")
│
├── 11. Escalation check
│       Fires ONLY when:
│         - user_requested_human = True  (set by ACTION:ESCALATE in router)
│         - escalation_enabled = True on profile
│       Low confidence and RAG fallback do NOT trigger escalation.
│       Creates: Nexus Live Escalation, updates conversation.status = "Escalated"
│
└── 12. publish_chat_response(conversation_id, result)
        Fires Socket.io event: nexus_chat_response
        → Browser renders AI message
```

**DocTypes written/read:**

| DocType | Action | Why |
|---|---|---|
| `Nexus Live Conversation` | Read + updated | Load context; update status |
| `Nexus Live Agent` | Updated | Status toggled Responding → Waiting |
| `Nexus Live Message` | Created | AI answer stored |
| `Nexus AI Agent Profile` | Read | Behavior, thresholds, intent overrides (not knowledge access) |
| `Nexus Intent Handler` | Read | Global intent handler definitions |
| `Nexus Profile Intent Override` | Read | Profile-level overrides for intent handlers |
| `Knowledge Profile` | Read | Access categories bundle; resolved via Identity Profile chain |
| `Nexus Access Category` | Read | Resolves allowed policies from knowledge profiles |
| `Nexus Access Policy` | Read | Final retrieval filter applied to chunks |
| `Nexus Knowledge Chunk` | Read | Filtered by access_policy, scored, returned as sources |
| `Nexus Query Log` | Created | Audit record of every query |
| `Nexus Live Escalation` | Created (if user requested) | Escalation record |

**Realtime events:**

| Event | When | Payload key |
|---|---|---|
| `nexus_chat_typing` | Before AI pipeline starts | `conversation_id` |
| `nexus_chat_response` | After AI answer is ready | `conversation_id`, `message`, `confidence`, `sources`, `escalated` |

**Client-side listener:**
```javascript
frappe.realtime.on("nexus_chat_response", function(data) {
    if (data.conversation_id !== my_conversation_id) return;
    hide_typing_indicator();
    if (data.status === "error") {
        show_error(data.error);
    } else {
        render_message(data.message, data.confidence);
    }
});
```

---

## User Story 4 — Visitor Sends a Follow-up Message

**Story:** Visitor reads the AI answer and asks a follow-up question. The chat uses the same conversation and remembers context.

**Function call:**

```
POST api/method/digitz_ai_nexus_live.api.live.send_chat_message
    Args: conversation_id
    Body: { message, tenant }
```

**Step-by-step inside `send_chat_message`:**

```
send_chat_message(conversation_id, payload)
│
├── 1. apply_session_user_context(payload)
│
├── 2. get_conversation(conversation_id)
│       Reads: Nexus Live Conversation — throws if not found or no agent assigned
│
├── 3. enrich_payload_from_conversation(payload, conversation)
│       Restores: tenant, channel, chat_category, identity_type,
│                 identity_registry, context, sub_context, entity_type
│       Restores: identity_safeguard_access_categories from conversation JSON
│
├── 4. add_message(conversation, sender_type="Visitor"|"User", message)
│       Creates: Nexus Live Message
│
├── 5. frappe.enqueue(_process_ai_response, queue="short", timeout=120s)
│
└── 6. Return immediately:
        { status: "processing", conversation_id }
```

**Key difference from start_chat:**
- No agent assignment (already assigned)
- No identity/profile resolution (restored from conversation snapshot)
- `build_chat_continuity_payload()` detects `is_follow_up = True` and injects prior message pairs as `conversation_context`
- Intent handlers are resolved fresh each turn (in case global config has changed)

**DocTypes read/written:**

| DocType | Action | Why |
|---|---|---|
| `Nexus Live Conversation` | Read | Load stored identity, profile, tenant, channel |
| `Nexus Live Message` | Created (visitor) + Created (AI) | New turn stored |

---

## User Story 5 — Visitor Asks to Speak to a Human

**Story:** Visitor types "I'd like to speak to someone" or "Can you connect me to support?". The system acknowledges the request and escalates the conversation.

**What happens:**

1. The router LLM sees `resolved_intents` which includes the "Human Agent Request" handler.
2. The LLM matches the user's message to the escalation trigger description.
3. The router returns `ACTION:ESCALATE`.
4. `answer_query()` returns `{ user_requested_human: True, answer: "<acknowledgement>" }`.
5. `live_chat_service` checks **all three** conditions before escalating:
   - `user_requested_human = True` ✓ (just set by the router)
   - `escalation_enabled = True` on the AI Agent Profile
   - `enable_escalation = 1` on the `Nexus Chat Category`
6. If all three are true: `create_escalation()` is called → `Nexus Live Escalation` record created → conversation status becomes `Escalated` (escalation_status = Pending).
7. `publish_escalation_alert` fires per-agent realtime alerts to eligible human agents.
8. The AI's acknowledgement message is sent to the visitor via realtime.

The visitor receives a warm acknowledgement (from the intent handler's `response_template`) rather than a cold system message.

After escalation, visitor messages are forwarded to the agent panel via `response_type="visitor_message"` and the visitor receives holding responses (`response_type="message_held"`). The AI is not invoked while escalated.

---

## Conversation ID vs Document Name

| Identifier | Example | Where used |
|---|---|---|
| Document name | `NLC-00001` | Frappe internal reference; used in desk links |
| `conversation_id` | `ABC123DEF456` | Client-facing token; sent in all API calls and realtime events |

`get_conversation()` accepts either. The client always uses `conversation_id`.

---

## Conversation Status Lifecycle

```
create_conversation()               → Open
update_conversation_assignment()    → Responding
_process_ai_response() ends         → (AI agent status: Waiting; conversation status unchanged)
user_requested_human = True         → Escalated  (escalation_status = Pending)
claim_conversation()                → escalation_status = Accepted
resolve_escalation()                → Responding; escalation_status = Resolved
_close_conversation_gracefully()    → Closed
close_idle_conversations()          → Closed  (idle timeout scheduled job)
close_conversation_by_agent()       → Closed  (human agent closes manually)
```

Note: The conversation `status` field does NOT use a "Waiting" state. "Waiting" applies only to the `Nexus AI Agent` record's internal status.

---

## Access Policy Resolution (summary)

```
resolve_allowed_policies({ai_profile: {knowledge_profile_names, ...}, ...})
│
├── force_public_only = True  →  ["Public"] only
│       Set when ANY of:
│         - identity_type = "Public"   (always, even if a named profile is configured)
│         - user_type = "Guest"
│         - no named profile AND no knowledge_profile_names
│
├── System Manager session  →  all enabled access policies
│
└── knowledge_profile_names present:
        profile_policies = union of all Knowledge Profiles' category policies
        cap = Identity Type safeguard → their policies  (class-level, from Nexus Identity Type)
        allowed = profile_policies ∩ cap  (no cap → profile_policies as-is)
│
└── knowledge_profile_names empty AND identity_type = "Public"
        →  ["Public"]  (identity_type cap fallback — ensures public visitors always get basic access)
│
└── knowledge_profile_names empty, non-Public identity  →  []  → retrieval denied (fails closed)
```

The safeguard comes from `Nexus Identity Type.safeguard_access_categories`, not from the
registry. It is a uniform class-level ceiling. Stored on the conversation as
`identity_safeguard_access_json` and restored on every follow-up turn.

---

## Quick Troubleshooting Reference

| Symptom | What to check |
|---|---|
| `start_chat` returns "no active route found" | `Nexus Category Identity Route` — verify a route exists for the category with `enabled = 1`. For public routes: `identity_profiles` child table must be empty (no rows = open to all). For registered routes: `identity_profiles` child table must be populated. |
| `start_chat` returns "no agent available" | `Nexus Live Agent` — check an approved, Idle agent exists for the channel |
| AI answer never arrives (typing indicator stays) | Background worker — run `bench worker --queue short`; check Redis |
| `allowed_access_policies` is empty; answer retrieval is denied | Trace the chain: `Nexus Identity Registry` (person exists and Verified?) → `Nexus Identity Profile` (enabled?) → `identity_mappings` rows (correct identity_type?) → `Knowledge Profile` (enabled Access Category?) → `Nexus Access Category` (policies configured?) → chunk `access_policy` matches? |
| Desk user denied access despite registry entry | Check `registry.user` field matches exact Frappe username. Check registry `verification_status = Verified`. Check Identity Profile has a mapping row for "Internal" or "Admin". |
| Public visitor getting empty policies | If no public route is configured for the category, the system finds no route and throws. Create a `Nexus Category Identity Route` for the category with `identity_profiles` child table left empty (empty = public/open to all). |
| User asks for human but escalation does not trigger | Check `escalation_enabled = True` on the `Nexus AI Agent Profile`; verify "Human Agent Request" handler is enabled in `Nexus Intent Handler` and not disabled in `Nexus Profile Intent Override` |
| `conversation_id` not found on follow-up | Client is sending document name (`NLC-00001`) instead of `conversation_id` hex string |
| Greeting treated as a knowledge query | Router LLM classification issue; check that the user message is a clear social exchange |
