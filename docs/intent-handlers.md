# Intent Handlers

Intent Handlers are the customisation layer between the conversational router and the RAG pipeline. They are the system's "trump card" — allowing precise, configured responses to specific situations without touching code.

---

## What They Do

Before the RAG pipeline runs, the LLM router receives the full list of resolved intent handlers for the current conversation. The LLM checks whether the user's message matches any handler, and returns a structured action token if it does.

This means:
- **Escalation** is not hardcoded — it is an intent handler the LLM matches against.
- **Predefined answers** (hours, prices, policies) are delivered without touching the knowledge base.
- **Disabled intents** are declined gracefully by the LLM with a context-aware message.

All matching is semantic (described in plain language), not keyword-based. The LLM reads the handler's `trigger_description` and decides whether the user's message fits.

---

## DocTypes

### `Nexus Intent Handler` (global)

Configured by system administrators. Applies to all profiles unless overridden.

| Field | Type | Purpose |
|---|---|---|
| `intent_name` | Data (unique) | Human-readable name, also the document key |
| `trigger_description` | Small Text | Natural-language description of when this intent fires. The LLM uses this to match user messages. |
| `action_type` | Select | `escalate` or `predefined_answer` |
| `response_template` | Text | The response to deliver when matched. Required for `predefined_answer`. Optional for `escalate` (a default is used if blank). |
| `priority` | Int | Lower number = evaluated first (default 10) |
| `enabled` | Check | Whether this handler is active globally |

### `Nexus Profile Intent Override` (profile-level, child table)

Attached to `Nexus AI Agent Profile` via the `intent_overrides` field.

| Field | Type | Purpose |
|---|---|---|
| `intent_handler` | Link → Nexus Intent Handler | Which global handler to override |
| `disabled` | Check | Disable this handler for this profile |
| `override_action_type` | Select | Change the action type for this profile only |
| `override_response` | Text | Replace the global `response_template` for this profile |
| `decline_response` | Text | What to say when the intent is disabled for this profile |

---

## Action Types

### `escalate`

When matched, the system:
1. Returns the `response_template` as the AI's answer (acknowledgement to the user).
2. Sets `user_requested_human: True` in the response.
3. `live_chat_service` reads this flag and creates a `Nexus Live Escalation` record.
4. The conversation status becomes `Escalated`.

### `predefined_answer`

When matched:
1. The `response_template` is returned as the answer directly.
2. No RAG pipeline is invoked.
3. `access_status` is set to `intent_handled`.

---

## Action Tokens

The router LLM returns one of these tokens when it matches an intent:

| Token | Meaning |
|---|---|
| `ACTION:ESCALATE` | Escalation intent matched |
| `ACTION:PREDEFINED:<handler-name>` | Predefined answer intent matched |
| `ACTION:DECLINED:<handler-name>` | Intent is disabled for this profile; decline gracefully |

`<handler-name>` is the document name of the `Nexus Intent Handler` (which equals `intent_name`).

---

## Resolution Logic

`intent_handler_service.resolve_intents_for_profile(profile_name)` runs before each conversation turn:

```
1. Load all enabled Nexus Intent Handler records, ordered by priority

2. If profile_name is given:
       Load profile's intent_overrides child table
       Build override_map: { intent_handler_name → override_row }

3. For each global handler:
       entry = base handler fields + active=True

       If override exists:
           If override.disabled:
               entry.active = False
               entry.decline_response = override.decline_response
           Else:
               If override.override_action_type → replace entry.action_type
               If override.override_response    → replace entry.response_template

4. Return list of resolved entries (active and inactive)
```

Both active and inactive (disabled) intents are returned. Inactive intents are passed to the router so the LLM can decline them gracefully instead of routing to knowledge.

---

## How Intent Handlers Appear in the Router Prompt

The router prompt has two sections built from resolved intents:

**Active intents** — evaluated first:
```
SPECIAL CASES (evaluate BEFORE routing rules, in priority order):

[1] Human Agent Request
    Trigger: User wants to speak to a human agent, live support, or a real person.
    If matched: respond with exactly: ACTION:ESCALATE

[2] Business Hours
    Trigger: User asks about working hours, when the office is open, or availability.
    If matched: respond with exactly: ACTION:PREDEFINED:Business Hours
```

**Disabled intents** — LLM declines gracefully:
```
UNAVAILABLE (acknowledge gracefully, do not route to knowledge):

- Product Pricing
  Trigger: User asks about pricing, subscription cost, or payment plans.
  If matched: respond with exactly: ACTION:DECLINED:Product Pricing
```

---

## Default Seed Data

One handler is created during setup:

| Field | Value |
|---|---|
| `intent_name` | Human Agent Request |
| `trigger_description` | User wants to speak to a human agent, live support, a real person, or explicitly asks to be connected to someone. |
| `action_type` | escalate |
| `response_template` | I understand — let me connect you with a team member who can assist you directly. |
| `priority` | 10 |
| `enabled` | Yes |

---

## Common Configurations

### Disable escalation for a specific profile

In `Nexus AI Agent Profile` → `Intent Overrides` tab:
- Add a row
- `intent_handler`: Human Agent Request
- `disabled`: ✓ (checked)
- `decline_response`: "I'm only able to provide automated responses at this time. Please contact us at support@company.com."

### Custom escalation acknowledgement per profile

- `intent_handler`: Human Agent Request
- `disabled`: unchecked
- `override_response`: "Got it — I'll flag this for one of our specialists. You'll hear back shortly."

### Add a predefined answer for support hours

In `Nexus Intent Handler`:
- `intent_name`: Support Hours
- `trigger_description`: User asks about support availability, opening hours, or when the team is online.
- `action_type`: predefined_answer
- `response_template`: Our support team is available Monday to Friday, 9 AM to 6 PM IST. For urgent issues, please email urgent@company.com.
- `priority`: 20
- `enabled`: Yes

---

## Cost Considerations

Intent handler matching requires one LLM call per user message in chat mode (the router call). This call is shared with conversational routing — it is not an additional call. If the user is asking a knowledge question, the router outputs `ROUTE_TO_KNOWLEDGE` and the RAG pipeline makes the second LLM call (the answer generation). So the cost per chat turn is:

| Turn type | LLM calls |
|---|---|
| Conversational (greeting, small talk) | 1 (router only) |
| Intent matched (escalate / predefined / declined) | 1 (router only) |
| Knowledge question (RAG) | 2 (router + answer generation) |
| Message too long | 1 (LLM nudge, no router) |
| Q&A mode (no router) | 1 (answer generation only) |
