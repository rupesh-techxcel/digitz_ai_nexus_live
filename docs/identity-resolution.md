# Identity Resolution

Identity resolution determines what knowledge a visitor can access. Every chat and Q&A request passes through `identity_resolver.resolve_identity_type(payload)` before retrieval runs.

---

## Priority Chain

Resolution stops at the first match. Steps are evaluated in strict order:

```
payload received
    │
    ▼
Step 1 — Trust payload identity
    trust_payload_identity = True  AND  identity_type in payload  AND  identity_type enabled?
    → return identity_type directly
    (Server-to-server integrations only. Never trust this from a browser.)
    │
    ▼
Step 2 — Verified OTP challenge
    identity_verification_challenge token present in payload?
    → get_verified_challenge(challenge_token, chat_category, email)
    → challenge exists AND status = "Verified"?
    → return challenge.resolved_identity_type
    │
    ▼
Step 3 — Nexus Identity Registry lookup
    _find_identity_registry(payload):
        1. Verified OTP challenge → registry attached to challenge
        2. Authenticated Frappe session user → registry where user = session_user
        3. trust_visitor_email = True AND email in payload → registry by email
    registry found AND verification_status = "Verified"?
    → walk active identity profiles → return first identity_type from mappings
    (Registry lookup precedes Frappe session so external websites are correctly served)
    │
    ▼
Step 4 — Frappe session fallback
    frappe.session.user != "Guest"?
    user_type = "Website User" → return "Customer"
    user_type = "System User" + "System Manager" role → return "Admin"
    user_type = "System User" → return "Internal"
    │
    ▼
Step 5 — API scope
    api_scope = "partner" → return "Partner"
    api_scope = "prospect" → return "Prospect"
    │
    ▼
Step 6 — Default floor: "Public"
    (Always reached when nothing above matched)
```

**Public is always the floor.** The system never fails completely on identity resolution — the worst case is Public access, which serves only knowledge tagged with the Public access policy.

---

## Nexus Identity Registry

The registry is the authoritative source of truth for all visitors — Frappe portal users and external website users alike. Each registry entry links a person to one or more Identity Profiles.

| Field | Purpose |
|---|---|
| `user` | Link to Frappe User (for portal/desk users) |
| `email` | Email address (for external website visitors) |
| `verification_status` | Pending / Verified / Blocked |
| `identity_profiles` | Child table of assigned Nexus Identity Profile rows |

**Active identity profiles** are filtered by `valid_from` / `valid_until` date ranges and sorted primary-first. The first mapping row with a non-null `identity_type` is returned.

**Blocked registries** raise an error — blocked visitors cannot access any knowledge.

---

## Identity Verification (OTP)

When identity cannot be resolved through Step 1–4 (visitor is Public) and retrieval finds nothing under public access, `live_chat_service` publishes `identity_verification_offer: true`. The widget renders an inline OTP form.

### OTP API

Both endpoints are `allow_guest=True` (accessible without a Frappe session).

**Issue OTP:**
```
POST digitz_ai_nexus_live.api.identity_verification.request_identity_verification
Args:
  email           — visitor's email address
  conversation_id — active conversation (server resolves channel + chat_category from it)

Returns:
  required        — 0 if verification is not needed for this category
  challenge_token — opaque token stored in widget state
  email           — normalized email
  expires_on      — UTC datetime when the OTP expires (10 min default)
  verification_mode — "Email OTP" | "Registered Email OTP"
```

**Verify OTP:**
```
POST digitz_ai_nexus_live.api.identity_verification.verify_identity_verification
Args:
  challenge_token — from request_identity_verification response
  otp             — 6-digit code entered by the visitor

Returns:
  status          — "verified"
  challenge_token — same token (store in S.identity_verification_challenge)
  email           — verified email
  identity_type   — resolved identity type (e.g. "Customer", "Partner")
  chat_category   — category the verification was issued for
```

**Verification modes** (set on `Nexus Chat Category.identity_verification_mode`):

| Mode | Behaviour |
|---|---|
| None | No verification required for this category |
| Email OTP | Any email accepted; OTP unlocks the visitor's registry identity if found, or defaults to Public |
| Registered Email OTP | Email must exist in the registry; unregistered emails are rejected (or fall back to Public if `allow_public_fallback = True`) |

### Widget State After Verification

```javascript
S.visitor_email                   = "visitor@example.com"
S.identity_verification_challenge = "abc123..."  // challenge_token
```

Every subsequent `send_chat_message` call includes both fields in the payload:
```json
{
  "message": "...",
  "tenant": "...",
  "visitor_email": "visitor@example.com",
  "identity_verification_challenge": "abc123..."
}
```

`identity_resolver` Step 2 picks up the challenge token and upgrades the identity type for that message.

Both fields are cleared (`null`) when a new conversation starts.

---

## Identity Knowledge Rules

`Nexus Identity Knowledge Rule` links an identity type to a Knowledge Profile without going through the full Identity Profile mapping chain. These rules are managed on the Knowledge Access Manager page under "Identity Allocation".

| Field | Purpose |
|---|---|
| `identity_type` | The identity class that gets access |
| `knowledge_profile` | The Knowledge Profile being allocated |
| `rule_label` | Human-readable label (auto-generated) |

These rules are a lighter-weight alternative to the full Identity Profile → mapping chain — useful when a direct identity type → knowledge profile link is sufficient.

---

## Access Category Allocation

`Nexus Access Category` records group access policies. Knowledge Profiles are linked to categories to grant access to the policies within them.

**Public-only categories are excluded from the Knowledge Access Manager allocation grid.** A category is "Public-only" when every policy in its `allowed_policies` child table has `policy_name = "Public"`. Assigning such a category to a Knowledge Profile adds no value because public knowledge is served autonomously to all visitors regardless of assignment.

The filter is applied in `nexus_profile_access_allocation.get_page_data` via `_exclude_public_only_categories()`. The `cat_count` badge on each Knowledge Profile also excludes Public-only assignments.

---

## Security Notes

- `trust_payload_identity` and `trust_visitor_email` are server-side flags. A browser that sends these without an `Authorization: token api_key:api_secret` header is making an untrusted assertion. Stripping these flags at the API boundary for unauthenticated requests is a planned hardening step.
- OTP challenges expire after 10 minutes and allow a maximum of 5 attempts before being marked Failed.
- A verified challenge is single-use in practice — once `status = "Verified"`, subsequent `verify_challenge` calls on the same token will be rejected (status is no longer "Pending").
