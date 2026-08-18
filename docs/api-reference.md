# API Reference

All endpoints are whitelisted Frappe API functions. Call them via:

```
POST /api/method/{dotted.module.path}
Content-Type: application/json
X-Frappe-CSRF-Token: {token}   # Not required for guest-accessible endpoints

{ ...payload... }
```

---

## Public Endpoints (Guest-Accessible)

These endpoints use `allow_guest=True`. No authentication is required.

For chat-category workflows, callers should pass `chat_category`. Website chat should pass `visitor_email` once known, but email only elevates identity after OTP verification. Trusted server-side integrations may pass `identity_type` with `trust_payload_identity`; otherwise Live derives identity from verified OTP challenges, the registry, Frappe session, and payload context.

### Request Identity Verification

```python
digitz_ai_nexus_live.api.identity_verification.request_identity_verification(
    channel,
    chat_category,
    email,
)
```

Starts an OTP challenge when the selected category uses `Email OTP` or `Registered Email OTP`. Returns a `challenge_token` that the browser keeps until OTP verification succeeds.

### Verify Identity Verification

```python
digitz_ai_nexus_live.api.identity_verification.verify_identity_verification(
    challenge_token,
    otp,
)
```

Marks the challenge as verified and returns the resolved identity type. Pass the returned `challenge_token` as `identity_verification_challenge` when calling `start_chat`.

### Chat Workflow Tester

```python
digitz_ai_nexus_live.api.nexus_chat_workflow_tester.simulate_workflow(
    channel,
    chat_category,
    visitor_email=None,
    assume_authenticated=0,
    assume_email_verified=0,
)
```

Admin-only helper used by `/nexus-chat-workflow-tester`. It previews category gates, registry match, resolved identity, profile route, access categories, and policies without creating a conversation or sending OTP.

### Identity Verification Monitor

```python
digitz_ai_nexus_live.api.nexus_identity_verification_monitor.get_challenges(
    status=None,
    email=None,
    limit=100,
)
```

Admin-only helper used by `/nexus-identity-verification-monitor` to inspect OTP challenge status, attempts, expiry, and resolved identity.

Current public guardrail behavior forces guest requests to public-only access in Nexus Core. If category-routed public visitors should receive policies from the routed profile instead, Live must avoid setting `force_public_only` for those category-routed requests and the Public identity route must be configured with only safe public access categories.

---

### `digitz_ai_nexus_live.api.live.ask_question`

Executes a stateless Q&A exchange.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| payload | dict | Yes | Query payload (see Payload Contract) |

**Returns:**

```json
{
  "answer": "...",
  "confidence": 0.82,
  "access_status": "allowed",
  "sources": [...],
  "fallback_used": false,
  "agent_code": "PUB-RESPONDER-01",
  "agent_name": "Public AI Assistant"
}
```

---

### `digitz_ai_nexus_live.api.live.start_chat`

Starts a new chat conversation and returns a `conversation_id` for follow-up messages.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| payload | dict | Yes | Chat payload including `message`, `channel`, optional `chat_category`, optional `identity_type`, and visitor fields |

**Example payload:**

```json
{
  "message": "I need help with my subscription.",
  "channel": "WEBSITE-CHAT",
  "chat_category": "CUSTOMER-SUPPORT",
  "identity_type": "Customer",
  "user_type": "Website User"
}
```

**Returns:**

```json
{
  "conversation_id": "NLCV-00001",
  "answer": "...",
  "confidence": 0.78,
  "agent_code": "PUB-RESPONDER-01",
  "agent_name": "Public AI Assistant",
  "sources": [...]
}
```

---

### `digitz_ai_nexus_live.api.live.send_chat_message`

Continues an existing chat conversation.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| conversation_id | str | Yes | The `conversation_id` returned by `start_chat` |
| payload | dict | Yes | Payload with `message`; category/profile context is preserved from the conversation snapshot |

**Returns — the answer does not come back on this call.**

For the normal AI path the request enqueues the work and returns immediately:

```json
{ "status": "processing", "conversation_id": "..." }
```

The reply is pushed later over `frappe.realtime` as a **`nexus_chat_response`**
event carrying the same `conversation_id`, with **`nexus_chat_typing`** driving
the typing indicator in the meantime. A caller that waits for an answer in this
response body will wait forever — subscribe first (`task_subscribe(conversation_id)`),
then send.

Some paths do answer synchronously, so `status` must be branched on rather than
assumed:

| `status` | Meaning |
|---|---|
| `processing` | Queued; the answer arrives via `nexus_chat_response` |
| `success` | Answered inline (for example an FAQ hit) |
| `await_category` | The visitor must pick a chat category before continuing |
| `category_selected` | A category was accepted; carry on sending |
| `escalated` | A human has taken over; messages are stored, the AI does not reply |
| `closed` | The conversation is closed; start a new one |
| `faq_not_found` | No FAQ matched under a FAQ-only category |

---

### `digitz_ai_nexus_live.api.live.get_widget_tenant`

Resolves a website widget code to its tenant before a chat is started. This is
the first call the embedded widget makes.

| Name | Type | Required | Description |
|---|---|---|---|
| widget_code | str | Yes | The code the host page sets in `window.NexusChatConfig` |

Where a `widget_code` is supplied by a Guest, `validate_widget_origin` checks the
HTTP `Origin` against the widget's `allowed_domains_json`. The check is skipped
for authenticated callers, and passes when no `Origin` header is present.

---

### `digitz_ai_nexus_live.api.live.get_conversation_detail`

The full message history of one conversation, used when the widget resumes a
stored session or the desk console opens an existing chat.

| Name | Type | Required | Description |
|---|---|---|---|
| conversation_id | str | Yes | |

---

### `digitz_ai_nexus_live.api.live.close_chat`

Closes a conversation. Once closed, `send_chat_message` returns `status: closed`
rather than accepting further input.

| Name | Type | Required | Description |
|---|---|---|---|
| conversation_id | str | Yes | |

---

### `digitz_ai_nexus_live.api.live.request_chat_transcript`

Starts an OTP challenge to email a transcript of the conversation to the
visitor. Pairs with `verify_chat_transcript_otp`; the transcript is only sent
once the code is verified, so a transcript cannot be mailed to an address the
visitor has not proved.

| Name | Type | Required | Description |
|---|---|---|---|
| conversation_id | str | Yes | |
| email | str | Yes | Where to send the transcript |

---

### `digitz_ai_nexus_live.api.live.verify_chat_transcript_otp`

Verifies the code from `request_chat_transcript` and sends the transcript.

| Name | Type | Required | Description |
|---|---|---|---|
| conversation_id | str | Yes | |
| otp | str | Yes | |

---

## Admin Endpoints (Authenticated)

These endpoints require an authenticated session and appropriate role.

---

### `digitz_ai_nexus_live.api.live_studio.get_live_studio_snapshot`

Returns a high-level overview for the Live Studio dashboard.

**Returns:**

```json
{
  "ai_agents": 4,
  "human_agents": 2,
  "channels": 5,
  "escalation_rules": 2,
  "pending_approvals": 1
}
```

---

### `digitz_ai_nexus_live.api.live_studio.get_workforce_agents`

Returns a list of all agents with their current status and session count.

**Returns:** List of agent records with `agent_code`, `agent_name`, `agent_type`, `agent_role`, `status`, `current_active_sessions`.

---

### `digitz_ai_nexus_live.api.live_studio.get_channels`

Returns all `Nexus Live Channel` records with routing configuration.

---

### `digitz_ai_nexus_live.api.live_studio.get_escalation_rules`

Returns all `Nexus Escalation Rule` records with queue and agent targets.

---

## Payload Contract

The payload is the primary input for Q&A and chat endpoints. Fields are passed as a JSON dict.

```python
payload = {
    # Required
    "query": "What is the refund policy?",

    # Routing
    "channel": "Website",           # Optional; Nexus Live Channel code
    "tenant": "ACME",               # Optional; resolved from user context if absent

    # Visitor context (for chat)
    "visitor_name": "John",
    "visitor_email": "john@example.com",

    # Agent preference (optional)
    "requested_agent": "SALES-BOT-01",  # Bypass routing; use this agent directly

    # Scope narrowing (optional)
    "business_unit": "Operations",
    "project": "Alpha",
    "context": "Sales",
    "sub_context": "Returns",
    "entity": "Refund Policy",
    "topic": "",

    # Chat continuation (send_chat_message only)
    "conversation_id": "NLCV-00001",
}
```

### Notes

- `channel` must match a `Nexus Live Channel.channel_code`.
- `tenant` is resolved from the authenticated user's `Nexus User Context` if absent.
- `business_unit`, `project`, `context`, `channel`, and `top_k` can be filled from the tenant configuration defaults when the payload does not provide them.
- Public endpoints force `force_public_only = True` regardless of any payload field. You cannot override this.
- `requested_agent` bypasses role inference and routes directly to the named agent if it is available.

---

## Error Responses

All endpoints return standard Frappe error structure on failure:

```json
{
  "exc_type": "ValidationError",
  "exception": "...",
  "exc": "..."
}
```

Common error cases:

| Error | Cause |
|---|---|
| `Access policy resolution produced no permitted policies` | Access resolver returned empty policy list |
| `No agent available for role X` | Routing found no eligible agent |
| `Conversation not found` | Invalid `conversation_id` in `send_chat_message` |
| `Escalation rule not found for role X` | Escalation triggered but no matching rule configured |
