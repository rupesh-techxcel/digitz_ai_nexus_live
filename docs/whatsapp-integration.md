# WhatsApp Integration

> Last updated: 2026-06-23
> Apps involved: `digitz_ai_nexus_live`, `frappe_whatsapp`
> Author: Nexus Platform

---

## 1. Overview

The WhatsApp integration allows visitors to receive Nexy's AI responses on WhatsApp instead of — or in addition to — the web chat widget. The integration is **channel-agnostic**: any existing Nexus Live Channel (Website Chat, Desk, Portal) can have WhatsApp delivery enabled. No separate "WhatsApp channel type" is needed.

### Design principles

**Delivery method, not channel type.** A Nexus Live Channel represents a topic/configuration unit — an AI profile, knowledge access rules, chat categories. The communication medium (browser widget vs WhatsApp) is a property of the conversation, not the channel. This means:

- The same AI profile, knowledge base, categories, companion mode, and escalation rules serve both web and WhatsApp visitors.
- Zero duplication of channel configuration.
- The channel's `whatsapp_account` field enables WhatsApp for that channel. Channels without it remain web-only.

**Two entry paths, one pipeline.**

| Entry path | Description |
|---|---|
| Web → WhatsApp | Visitor starts on the web widget, clicks "Continue on WhatsApp", registers their phone via OTP, and Nexy's future replies go to WhatsApp. The web conversation is promoted to WhatsApp delivery. |
| Cold WhatsApp | Visitor texts the business WhatsApp number directly. A new conversation is created on the channel linked to that WhatsApp account. Same AI, same categories. |

**One-way switch.** Delivery can change from Web to WhatsApp (when the visitor registers). It cannot change from WhatsApp back to Web — a visitor who starts on WhatsApp stays there. This matches how WhatsApp works in practice.

**Phone verification mirrors email OTP.** The same UX pattern used for email identity verification is reused for phone registration — a 6-digit code, 5-minute TTL, 5-attempt maximum.

---

## 2. Architecture

### 2.1 Core concept: `delivery_method`

Every `Nexus Live Conversation` carries one new field:

```
delivery_method: "Web" | "WhatsApp"   (default: "Web")
```

The entire delivery routing decision lives in this single field. The AI pipeline — knowledge retrieval, answer generation, companion mode, escalation — runs identically regardless. Only the final delivery step forks:

```
_process_ai_response()
  → publish_chat_response()          always fires (desk console, realtime)
  → if delivery_method == "WhatsApp"
       send_whatsapp_reply(phone, answer, account)   also fires
```

### 2.2 Channel WhatsApp config

`Nexus Live Channel` gains a collapsible **WhatsApp Settings** section with two fields:

| Field | Type | Purpose |
|---|---|---|
| `whatsapp_account` | Link → WhatsApp Account | The frappe_whatsapp account used to send/receive on this channel. Also used for cold inbound routing: phone → WhatsApp account → this channel. |
| `whatsapp_phone_display` | Data | E.164 phone number shown in the widget strip (e.g. `919876543210`). |

These fields are available on every channel type — not conditional on any `channel_type` value.

### 2.3 System flow — web visitor switches to WhatsApp

```
Web widget open
  │
  ├─ Visitor clicks "Continue on WhatsApp" strip
  │    → Registration panel opens inline
  │
  ├─ Visitor enters phone number
  │    → POST request_whatsapp_registration(conversation_id, phone)
  │    → whatsapp_otp_service.request_whatsapp_otp()
  │         → 6-digit OTP generated, cached in Redis (5 min TTL)
  │         → WhatsApp Message (type=Outgoing) created
  │         → frappe_whatsapp before_insert → Meta API → OTP delivered
  │    → Panel shows OTP input form
  │
  ├─ Visitor enters OTP
  │    → POST verify_whatsapp_registration(conversation_id, otp)
  │    → whatsapp_otp_service.verify_whatsapp_otp()
  │         → OTP matched, attempts checked
  │         → conversation.visitor_phone = phone
  │         → conversation.delivery_method = "WhatsApp"
  │         → Nexus Web Visitor created/linked with visitor_phone
  │         → OTP cleared from cache
  │    → Realtime event: response_type="whatsapp_registered"
  │
  └─ Widget receives realtime event
       → Swap panel to: "✓ WhatsApp connected! You can close this window."
       → Strip hidden

From this point: all _process_ai_response() calls
  → publish_chat_response() (realtime, visible in desk console)
  → send_whatsapp_reply(visitor_phone, answer, whatsapp_account)
```

### 2.4 System flow — cold WhatsApp contact

```
Meta API (visitor messages business number)
  → frappe_whatsapp webhook.post()
  → WhatsApp Message inserted (type=Incoming)
  → after_insert hook: on_whatsapp_message(doc, method)
       │
       ├─ doc.type != "Incoming" → skip
       ├─ doc.content_type == "reaction" → skip
       │
       ├─ _get_channel_for_account(whatsapp_account)
       │    → Nexus Live Channel with whatsapp_account=<account>
       │    → None → return (no channel configured)
       │
       ├─ _get_or_create_visitor(phone, profile_name, tenant)
       │    → Query Nexus Web Visitor WHERE visitor_phone=phone AND tenant=tenant
       │    → Found: update last_seen, return
       │    → Not found: create new visitor (visitor_id="wa:{phone}")
       │
       ├─ _get_or_create_conversation(visitor, channel)
       │    → Query open conversation WHERE web_visitor=visitor
       │      AND channel=channel AND last_message_at >= NOW()-24h
       │    → Found (existing session): return (is_new=False)
       │    → Not found: create_conversation(payload, assigned_agent)
       │         → delivery_method = "WhatsApp" set on creation
       │         → is_new = True
       │
       ├─ is_new = True → _handle_new_conversation()
       │    → Send greeting via WhatsApp
       │    → If channel has categories:
       │         → _send_category_picker_whatsapp() (interactive buttons/list)
       │         → Store number→code map in Redis
       │         → conversation.intent = "await_category"
       │    → If no categories:
       │         → _enqueue_ai(conversation, message_text, phone)
       │
       └─ is_new = False → _handle_existing_conversation()
            → intent == "await_category":
            │    → content_type="button" → message IS category_code → enqueue AI
            │    → digit → resolve from Redis map → enqueue AI
            │    → text label → case-insensitive match → enqueue AI
            │    → no match → resend picker with nudge
            └─ intent != "await_category":
                 → _enqueue_ai(conversation, message_text, phone)

_enqueue_ai()
  → add_message(sender_type="Visitor")
  → frappe.enqueue(continue_live_chat, ...)
  → ... same AI pipeline as web widget ...
  → _process_ai_response() → WhatsApp delivery fork fires
```

---

## 3. Modified DocTypes

### 3.1 Nexus Live Channel

**Module:** `Nexus Live Channels` (`digitz_ai_nexus_live`)

**Fields added:**

| Fieldname | Type | Label | Notes |
|---|---|---|---|
| `section_whatsapp` | Section Break | WhatsApp Settings | Collapsible |
| `whatsapp_account` | Link → WhatsApp Account | WhatsApp Account | frappe_whatsapp account for send/receive |
| `whatsapp_phone_display` | Data | WhatsApp Phone Number | E.164, shown in widget strip |

**Fields removed / reverted:**

The `channel_type` option `"WhatsApp"` was added and then reverted. WhatsApp is not a channel type — it is a delivery method on the conversation. The `channel_type` values remain: `Website Q&A`, `Website Chat`, `Desk`, `Portal`, `API`.

### 3.2 Nexus Live Conversation

**Module:** `Nexus Live Conversations` (`digitz_ai_nexus_live`)

**Fields added:**

| Fieldname | Type | Label | Default | Notes |
|---|---|---|---|---|
| `delivery_method` | Select | Delivery Method | `Web` | Options: `Web`, `WhatsApp`. The single switch controlling how Nexy's responses reach the visitor. |
| `wa_otp_phone` | Data | WhatsApp OTP Phone | — | Unverified phone during the OTP flow. Hidden field. Cleared after verification. |

The existing `visitor_phone` field is repurposed: it holds the **verified** WhatsApp phone number. `wa_otp_phone` holds the **unverified** number during the OTP window.

### 3.3 Nexus Web Visitor

**Module:** `Nexus Visitor Analytics` (`digitz_ai_nexus_live`)

**Fields added:**

| Fieldname | Type | Label | Notes |
|---|---|---|---|
| `visitor_phone` | Data | WhatsApp Phone | E.164. Indexed. Used as identity anchor for WhatsApp visitors. Visitor ID is prefixed `wa:{phone}` for cold contacts. |

---

## 4. New Services

### 4.1 `whatsapp_service.py`

**Location:** `digitz_ai_nexus_live/services/whatsapp_service.py`

**Purpose:** Inbound bridge between frappe_whatsapp and the Nexus Live AI pipeline, plus outbound delivery resolution.

**Public functions:**

#### `on_whatsapp_message(doc, method)`

After-insert hook called by Frappe when a `WhatsApp Message` record is created. Routes incoming messages into the Nexus pipeline.

**Guards:**
- `doc.type != "Incoming"` → return (outgoing messages also trigger after_insert)
- `doc.content_type == "reaction"` → return (emoji reactions are not routable)
- No `whatsapp_account` → channel not configured → return

**Content type handling:**

| Content type | Treatment |
|---|---|
| `text` | Passed as-is |
| `button` / `list_reply` | Message field contains the button/list item ID (= category code) |
| `image`, `audio`, `video`, `document` | Prefixed: `[Image received]: caption` |
| `reaction` | Ignored |
| others with no text | Ignored |

#### `send_whatsapp_reply(phone, text, whatsapp_account_name)`

Sends a plain-text reply by inserting a `WhatsApp Message` record with `type=Outgoing`. frappe_whatsapp's `before_insert` hook dispatches it to the Meta API automatically.

Markdown is stripped before sending (`_strip_markdown()`) — ATX headers, links, inline code, fenced code blocks, horizontal rules — because WhatsApp renders its own limited formatting (bold via `*`, italic via `_`) and breaks on HTML-style markdown.

Maximum message length: 4096 characters (Meta API limit).

#### `get_whatsapp_delivery_for_conversation(conversation) → (account, phone) | (None, None)`

Called by `_process_ai_response()` to determine if WhatsApp delivery applies. Returns the `(whatsapp_account_name, visitor_phone)` tuple only when:
- `conversation.delivery_method == "WhatsApp"`
- `conversation.visitor_phone` is non-empty
- The channel has a `whatsapp_account` configured

Does **not** check `channel_type`. Channel type is irrelevant to delivery routing.

**Internal functions:**

| Function | Purpose |
|---|---|
| `_get_channel_for_account(whatsapp_account)` | Find the first enabled Nexus Live Channel linked to this WhatsApp Account |
| `_get_or_create_visitor(phone, profile_name, tenant)` | Identity resolution — phone → Nexus Web Visitor |
| `_get_or_create_conversation(visitor, channel)` | Session management — find open conversation within 24h window or create new |
| `_handle_new_conversation(...)` | Greeting + category picker or direct AI for fresh sessions |
| `_handle_existing_conversation(...)` | Route ongoing messages — category resolution or AI |
| `_send_category_picker_whatsapp(...)` | WhatsApp interactive button/list message for category selection |
| `_enqueue_ai(conversation, message, phone)` | Record visitor message + enqueue `continue_live_chat()` |
| `_strip_markdown(text)` | Clean markdown for WhatsApp delivery |

### 4.2 `whatsapp_otp_service.py`

**Location:** `digitz_ai_nexus_live/services/whatsapp_otp_service.py`

**Purpose:** Phone OTP registration flow — generate, send, and verify a 6-digit code delivered via WhatsApp.

**Constants:**

| Name | Value | Purpose |
|---|---|---|
| `_OTP_TTL_SECONDS` | 300 | OTP cache TTL (5 minutes) |
| `_OTP_DIGITS` | 6 | Code length |
| `_MAX_ATTEMPTS` | 5 | Incorrect attempts before lockout |

**Public functions:**

#### `request_whatsapp_otp(conversation_id, phone) → {"status": "sent", "phone": "***3210"}`

1. Normalises the phone number — strips spaces, dashes, parentheses; validates `^\+?\d{7,15}$`; strips leading `+` (frappe_whatsapp's `format_number` handles the `+` prefix)
2. Checks the conversation exists, is open, and is not already WhatsApp-registered
3. Resolves `whatsapp_account` from the conversation's channel
4. Generates a 6-digit random OTP
5. Stores `{otp, phone, attempts: 0, sent_at}` in Frappe cache keyed `nexus_wa_otp:{conversation_id}` with 5-minute TTL
6. Creates a `WhatsApp Message` (type=Outgoing) with the OTP message text
7. Stamps `conversation.wa_otp_phone` with the unverified number
8. Returns masked phone for display

**OTP message text:**
```
Your Nexy verification code is: *483921*

This code expires in 5 minutes. Do not share it with anyone.
```

#### `verify_whatsapp_otp(conversation_id, otp_input) → {"status": "verified", "phone": "***3210"}`

1. Loads OTP record from cache — throws if expired
2. Checks attempt count — throws and clears if ≥ `_MAX_ATTEMPTS`
3. Compares stripped OTP — increments attempt counter and throws if mismatch
4. On match: sets `conversation.visitor_phone`, `conversation.delivery_method = "WhatsApp"`, clears `wa_otp_phone`
5. Calls `_link_whatsapp_visitor()` — creates/updates `Nexus Web Visitor` with this phone
6. Clears OTP from cache

**Internal functions:**

| Function | Purpose |
|---|---|
| `_get_conversation(conversation_id)` | Fetch conversation row (name, channel, visitor_phone, delivery_method, status, web_visitor) |
| `_resolve_whatsapp_account(conversation)` | Read whatsapp_account from conversation's channel |
| `_generate_otp()` | Random 6-digit string |
| `_store_otp / _load_otp / _clear_otp` | Redis cache operations |
| `_send_otp_message(phone, otp, account)` | Create WhatsApp Message for delivery |
| `_link_whatsapp_visitor(conversation, phone)` | Create or update Nexus Web Visitor, link to conversation |
| `_normalise_phone(phone)` | Strip formatting, validate, strip leading `+` |
| `_mask_phone(phone)` | Return `****3210` form for UI display |

---

## 5. Modified Services

### 5.1 `live_chat_service.py` — WhatsApp delivery fork

**Location:** `digitz_ai_nexus_live/services/live_chat_service.py`

In `_process_ai_response()`, after `publish_chat_response()` fires the WebSocket realtime event, a second delivery step is attempted for WhatsApp conversations:

```python
try:
    from digitz_ai_nexus_live.services.whatsapp_service import (
        get_whatsapp_delivery_for_conversation,
        send_whatsapp_reply,
    )
    _wa_account, _wa_phone = get_whatsapp_delivery_for_conversation(conversation)
    if _wa_account and _wa_phone:
        send_whatsapp_reply(_wa_phone, answer, _wa_account)
except Exception:
    frappe.log_error(frappe.get_traceback(), "Nexus WhatsApp: outbound delivery failed")
```

Key properties:
- The `publish_chat_response()` call always fires — the desk console can always observe the transcript regardless of delivery method
- The WhatsApp send is isolated in a try/except — a WhatsApp delivery failure does not propagate and does not affect the stored message record
- The check is on `conversation.delivery_method`, not on `channel_type` or any channel-level attribute

---

## 6. API Endpoints

Both endpoints are in `digitz_ai_nexus_live/api/live.py` and are `allow_guest=True`.

### 6.1 `request_whatsapp_registration`

```
POST /api/method/digitz_ai_nexus_live.api.live.request_whatsapp_registration

Parameters:
  conversation_id  string   required
  phone            string   required   — any common format accepted
  caller_token     string   required for Guest conversations

Rate limit: 5 calls per 300 seconds per IP

Response (success):
  { "message": { "status": "sent", "phone": "***3210" } }

Errors:
  — Invalid phone number
  — WhatsApp not configured for this channel
  — Already WhatsApp-registered
  — Conversation not found / closed
  — Access denied (bad caller_token)
  — Rate limit exceeded
```

### 6.2 `verify_whatsapp_registration`

```
POST /api/method/digitz_ai_nexus_live.api.live.verify_whatsapp_registration

Parameters:
  conversation_id  string   required
  otp              string   required   — 6-digit code
  caller_token     string   required for Guest conversations

Response (success):
  { "message": { "status": "verified", "phone": "***3210" } }

Side effects:
  — conversation.visitor_phone set
  — conversation.delivery_method = "WhatsApp"
  — Nexus Web Visitor created or updated
  — Realtime event published: response_type="whatsapp_registered"

Errors:
  — OTP expired
  — Too many incorrect attempts (OTP cleared — must request new)
  — Incorrect code (N attempts remaining)
  — Conversation not found / closed
  — Access denied
```

---

## 7. Widget — WhatsApp Registration UX

### 7.1 HTML structure

The widget now contains two adjacent elements below the header:

**`#ncw-wa-strip`** — always-visible green strip (hidden after successful registration):

```
[ WA icon ] [ Continue on WhatsApp ] [ → ] [ × ]
```

Clicking the strip (anywhere except `×`) toggles the registration panel. The `×` button dismisses the strip for the session.

**`#ncw-wa-panel`** — inline registration panel (hidden by default):

Three sequential steps, each shown/hidden as the flow progresses:

| Step | Element ID | Shows |
|---|---|---|
| Phone entry | `#ncw-wa-phone-step` | Number input + "Send code" button |
| OTP entry | `#ncw-wa-otp-step` | 6-digit input + "Verify" button + "Resend code" link |
| Done | `#ncw-wa-done-step` | "✓ WhatsApp connected! You can close this window." |

### 7.2 State machine

```
[Strip shown]
  ↓ click strip
[Panel: phone-step shown]
  ↓ enter phone → click "Send code"
  → API: request_whatsapp_registration
  ↓ success (status=sent)
[Panel: otp-step shown, phone-step hidden]
  ↓ enter OTP → click "Verify"
  → API: verify_whatsapp_registration
  ↓ success → realtime event: whatsapp_registered
[Panel: done-step shown, strip hidden]
  ↓ visitor closes browser
[Conversation delivery_method=WhatsApp permanently]

  [Error on send code]
  → error shown under phone input, button re-enabled
  [Error on verify]
  → error shown under OTP input, button re-enabled
  [Click "Resend code"]
  → otp-step hidden, phone-step shown
```

### 7.3 JavaScript functions added (in `bind_ui_events()`)

| Function | Purpose |
|---|---|
| `_wa_send_otp()` | Async handler for "Send code" — calls `request_whatsapp_registration` API |
| `_wa_verify_otp()` | Async handler for "Verify" — calls `verify_whatsapp_registration` API |
| `_wa_phone_err(msg)` | Show error under phone input |
| `_wa_otp_err(msg)` | Show error under OTP input |

### 7.4 Realtime event: `whatsapp_registered`

When `verify_whatsapp_registration` succeeds, the server publishes a `nexus_chat_response` event with `response_type="whatsapp_registered"`. The widget's `bind_realtime()` handler intercepts this and transitions directly to the done step — no polling.

---

## 8. Session Management

WhatsApp conversations use a **24-hour idle window** — matching WhatsApp's own free-tier messaging window.

**Active session lookup (in `_get_or_create_conversation()`):**
```sql
SELECT name FROM `tabNexus Live Conversation`
WHERE web_visitor = {visitor}
  AND channel = {channel}
  AND status = 'Open'
  AND last_message_at >= NOW() - INTERVAL 24 HOUR
ORDER BY creation DESC
LIMIT 1
```

If found: the existing conversation is resumed. The visitor's journey stage, enquiry, persona match, and discovery data all continue seamlessly.

If not found: a new conversation is created. `delivery_method` is set to `"WhatsApp"` at creation. The `last_message_at` field is stamped immediately.

**24h expiry behavior:** After 24 hours of silence, the next visitor message creates a new conversation. Nexy greets them fresh, re-shows the category picker if configured, and starts a new companion enquiry.

**Note on WhatsApp templates:** After 24h without a visitor message, the Meta API requires pre-approved message templates for business-initiated messages. The current implementation does not proactively re-engage visitors — Nexy only replies. Outbound re-engagement via templates is a planned future extension.

---

## 9. Identity Model

### 9.1 Cold WhatsApp visitor

```
Phone number → Nexus Web Visitor
  visitor_id    = "wa:{phone}"   (e.g. "wa:919876543210")
  visitor_phone = "{phone}"
  tenant        = channel.tenant
  visitor_type  = "Anonymous"    (initially)
```

`visitor_id` uses the `wa:` prefix to avoid collision with web visitor UUIDs (which are random alphanumeric strings).

### 9.2 Web visitor who registers WhatsApp

The web visitor's existing `Nexus Web Visitor` record is **linked** to the conversation via `web_visitor`. After OTP verification, a separate `Nexus Web Visitor` record is created (or found if already existing) with `visitor_phone` set. The two records are distinct — future identity merging (matching the web visitor's email to the WhatsApp phone) is a planned enhancement.

When `_link_whatsapp_visitor()` is called:
1. Checks if a `Nexus Web Visitor` with `visitor_phone = phone` and `tenant = channel.tenant` already exists
2. If yes: updates `last_seen`, upgrades `visitor_type` to `"Known"`, links to the conversation if not already linked
3. If no: creates a new visitor record with `visitor_id = "wa:{phone}"`

### 9.3 Future inbound routing

On the visitor's next cold WhatsApp message (new session after 24h, or a different conversation), the phone lookup finds their existing `Nexus Web Visitor` record and they are recognized as a returning contact. Their history is accessible to Nexy through the conversation's companion context.

---

## 10. Category Handling on WhatsApp

### 10.1 Interactive category picker

When a channel has `Nexus Chat Category` records (enabled + published), new WhatsApp visitors see a category picker. Instead of the web widget's rendered HTML buttons, WhatsApp receives an **interactive message**:

| Category count | WhatsApp message type |
|---|---|
| 1–3 | Button message (up to 3 inline reply buttons) |
| 4–10 | List message (scrollable list with descriptions) |
| > 10 | Numbered text fallback (plain text, reply with number) |

Button/list item ID is set to the `category_code`. When the visitor replies by tapping a button or list item, frappe_whatsapp's webhook creates an incoming `WhatsApp Message` with `content_type="button"` and `message=category_code`.

### 10.2 Category resolution in `_handle_existing_conversation()`

When `conversation.intent == "await_category"`, the visitor's reply is resolved in this order:

1. `content_type == "button"` and message is a valid category_code → direct match (button/list reply)
2. Message is a digit → look up in Redis map `nexus_wa_cat_map:{conversation_id}` (number→code)
3. Message text matches category label or code (case-insensitive) → text match
4. No match → resend picker with nudge: `"Please select one of the options below:"`

### 10.3 Redis category map

When the category picker is sent, a number-to-code map is cached in Redis:
```
key: nexus_wa_cat_map:{conversation_id}
value: {"1": "SUPPORT", "2": "SALES", "3": "GENERAL"}
TTL: 24 hours
```

This allows visitors who receive the numbered text fallback to reply `"2"` and have it correctly resolved.

---

## 11. Outbound Delivery: Markdown Stripping

WhatsApp uses its own limited formatting syntax and does not render Markdown. Before sending any message via `send_whatsapp_reply()`, the `_strip_markdown()` function removes:

| Construct | Removed / Replaced |
|---|---|
| ATX headers (`# Title`) | Prefix stripped |
| Markdown links (`[text](url)`) | Replaced with `text (url)` |
| Inline code (`` `code` ``) | Backticks stripped |
| Fenced code blocks (` ``` `) | Replaced with `[code block]` |
| Horizontal rules (`---`, `***`) | Removed |

WhatsApp-native formatting (`*bold*`, `_italic_`, `~strikethrough~`) is preserved.

---

## 12. Frappe Hooks

### `digitz_ai_nexus_live/hooks.py`

```python
doc_events = {
    "WhatsApp Message": {
        "after_insert": "digitz_ai_nexus_live.services.whatsapp_service.on_whatsapp_message",
    }
}
```

This fires for every `WhatsApp Message` insert — both incoming and outgoing. The handler's first guard (`doc.type != "Incoming"`) silently returns for outgoing messages.

**Note:** `frappe_whatsapp/hooks.py` registers a wildcard `after_insert` handler (`run_server_script_for_doc_event`) that also fires. The Nexus hook runs independently and does not interfere with it.

---

## 13. Configuration Guide

### 13.1 Prerequisites

- `frappe_whatsapp` app installed and configured
- At least one `WhatsApp Account` record with valid Meta API credentials
- Meta webhook pointed at `https://{your-site}/api/method/frappe_whatsapp.utils.webhook.webhook`
- Webhook verify token set on the `WhatsApp Account` record

### 13.2 Enabling WhatsApp on a channel

1. Open **Nexus Live Channel** in Frappe Desk
2. Expand the **WhatsApp Settings** section
3. Set **WhatsApp Account** → select your WhatsApp Account record
4. Set **WhatsApp Phone Number** → E.164 format without `+` prefix (e.g. `919876543210`)
   - This is the number shown in the widget strip
   - It should match the phone number registered with Meta for the selected account
5. Save

### 13.3 Running the migration

After any DocType change:
```bash
bench --site {site-name} migrate
```

This applies the new `delivery_method`, `wa_otp_phone` fields on `Nexus Live Conversation`, `visitor_phone` on `Nexus Web Visitor`, and the WhatsApp Settings fields on `Nexus Live Channel`.

### 13.4 Building frontend assets

```bash
bench build --app digitz_ai_nexus_live
```

The widget bundle includes the registration panel HTML, JS flow functions, and CSS.

### 13.5 Verifying the integration

**Test cold inbound:**
1. Send a message to the business WhatsApp number from a personal phone
2. Verify a `WhatsApp Message` (Incoming) record is created in Frappe
3. Verify a `Nexus Web Visitor` is created with `visitor_phone` set
4. Verify a `Nexus Live Conversation` is created with `delivery_method=WhatsApp`
5. Verify Nexy's reply arrives on WhatsApp within a few seconds

**Test web-to-WhatsApp:**
1. Open the web widget in a browser
2. Click "Continue on WhatsApp" strip
3. Enter a valid WhatsApp number
4. Verify the OTP arrives on WhatsApp
5. Enter the OTP in the widget
6. Verify the widget shows the "Connected" confirmation
7. Send a chat message in the widget
8. Verify the reply arrives on WhatsApp

---

## 14. File Reference

### New files

| File | App | Purpose |
|---|---|---|
| `services/whatsapp_service.py` | `digitz_ai_nexus_live` | Inbound bridge + outbound delivery helper |
| `services/whatsapp_otp_service.py` | `digitz_ai_nexus_live` | Phone OTP send/verify cycle |

### Modified files

| File | App | Change |
|---|---|---|
| `nexus_live_channels/doctype/nexus_live_channel/nexus_live_channel.json` | `digitz_ai_nexus_live` | Added `whatsapp_account`, `whatsapp_phone_display`, `section_whatsapp` fields; reverted channel_type options |
| `nexus_live_conversations/doctype/nexus_live_conversation/nexus_live_conversation.json` | `digitz_ai_nexus_live` | Added `delivery_method`, `wa_otp_phone` fields |
| `nexus_visitor_analytics/doctype/nexus_web_visitor/nexus_web_visitor.json` | `digitz_ai_nexus_live` | Added `visitor_phone` field (indexed) |
| `services/live_chat_service.py` | `digitz_ai_nexus_live` | WhatsApp delivery fork in `_process_ai_response()` |
| `api/live.py` | `digitz_ai_nexus_live` | Added `request_whatsapp_registration`, `verify_whatsapp_registration` endpoints; added `whatsapp_phone` to `start_chat` response |
| `public/js/nexus_chat_widget.bundle.js` | `digitz_ai_nexus_live` | Replaced coming-soon strip with inline registration panel + OTP flow; added realtime `whatsapp_registered` handler |
| `hooks.py` | `digitz_ai_nexus_live` | Added `WhatsApp Message` after_insert doc_event |

---

## 15. Known Constraints and Future Work

### 15.1 WhatsApp 24-hour messaging window

The Meta WhatsApp Business API enforces a **24-hour user-initiated conversation window**. Within 24 hours of the visitor's last message, Nexy can send free-form text replies. After 24 hours, only pre-approved **message templates** can be sent. The current implementation does not handle this boundary — if Nexy replies to a visitor whose 24-hour window has expired, the send will fail and an error will be logged.

**Planned:** Detect the Meta API error code for expired window and suppress the error gracefully. Business-initiated re-engagement (sending a template to re-open the window) is a separate feature requiring Meta template approval.

### 15.2 Media from visitors

Images, audio, video, and documents received from visitors are stored by frappe_whatsapp and passed to Nexy as `[Image received]: caption`. Nexy cannot currently analyze or reference the media content. Vision-capable AI models could process images in a future iteration.

### 15.3 Identity merging

A visitor who chats on the web widget (email-verified) and also registers via WhatsApp OTP has two separate `Nexus Web Visitor` records. Future work: match on verified email ↔ verified phone to merge into a single visitor identity, giving Nexy a unified conversation history across channels.

### 15.4 Multiple WhatsApp accounts per tenant

The current implementation links one `WhatsApp Account` per channel. A tenant with multiple WhatsApp business numbers needs multiple channels. True multi-number support (multiple accounts on a single channel) is not yet implemented.

### 15.5 Outbound template messages

Proactive re-engagement (sending the first message to a visitor who has not contacted recently) requires Meta-approved templates. The `WhatsApp Templates` DocType in frappe_whatsapp supports this but it is not integrated with the Nexus pipeline yet.

### 15.6 WhatsApp formatting

The markdown stripper covers the most common Markdown constructs. Nexy's LLM may still produce lists using `- ` or `* ` prefixes, which WhatsApp renders as plain text. Translating Markdown lists to WhatsApp-compatible formatting (or instructing the LLM to avoid them) is a future refinement.
