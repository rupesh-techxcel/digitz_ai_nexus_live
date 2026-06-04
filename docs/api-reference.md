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

**Returns:**

```json
{
  "answer": "...",
  "confidence": 0.71,
  "escalation_status": null,
  "sources": [...],
  "fallback_used": false
}
```

If escalation was triggered, `escalation_status` will be `"Pending"` or `"Assigned"`.

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
  "behaviours": 3,
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

### `digitz_ai_nexus_live.api.live_studio.get_behaviour_profiles`

Returns all active `Nexus AI Behaviour` records.

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
    "channel": "Website",           # Nexus Live Channel code
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
