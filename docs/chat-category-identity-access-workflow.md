# Chat Category, Identity, Profile, and Access Workflow

This document is the working contract for the Nexus Live chat workflow.

The requirement is:

```
visitor chat request
  → chat category selected by the user
  → identity type resolved for the user
  → AI Agent Profile allocated through the category/identity route
  → profile access categories resolved
  → access policies resolved
  → knowledge chunks filtered by those policies
```

---

## Configuration Chain

### 1. Chat Category

`Nexus Chat Category` is the option shown in the chat UI, such as Customer Support, Product Enquiry, or Sales.

Key fields:

| Field | Purpose |
|---|---|
| category_code | Stable category identifier |
| category_label | Display label shown to the user |
| channel | Live channel this category belongs to |
| requires_authentication | Whether guests may use this category |
| identity_verification_mode | Whether the category needs email OTP before chat starts |
| allow_public_fallback | Whether registered-email OTP may continue as Public when no registry match exists |
| enabled | Whether the category is selectable |

The category does not grant access by itself.

### 2. Identity Type

`identity_type` identifies who is asking through chat. It is a Link to the `Nexus Identity Type` DocType, not a fixed Select field.

Seeded default identity records:

```
Public
Customer
Prospect
Partner
Internal
Admin
```

Formal identity registration is handled by `Nexus Identity Registry`. One registry record represents the real person or party joining chat, usually keyed by verified email and optionally linked to `User`, `Contact`, or any installed business DocType through the generic reference fields.

One registry record can hold multiple enabled identity rows. For example, the same email can be registered as both `Customer` and `Partner` if both relationships are verified.

Runtime resolution lives in:

```
digitz_ai_nexus_live.services.identity_resolver.resolve_identity_type
```

Resolution priority:

1. Trusted explicit `identity_type` in the payload, for server-side integrations only. The value must reference an enabled `Nexus Identity Type`.
2. Verified OTP challenge, or authenticated session matched to `Nexus Identity Registry`.
3. If a chat category is selected, pick the registered identity that has an enabled `Nexus Category Identity Route` for that category.
4. If no category route matches, use the registry row marked primary, then the first enabled valid identity row.
5. Frappe session user and `user_type`.
6. `api_scope` for partner/prospect integrations.
7. `Public` fallback.

Unverified registry records do not elevate access. Blocked registry records are denied. A manually supplied email is not trusted for identity elevation unless it has passed OTP verification or comes from a trusted server-side integration.

Category verification modes:

| Mode | Meaning |
|---|---|
| None | No OTP required. Public fallback is allowed unless the category requires login. |
| Email OTP | Visitor must prove control of the email. Registry may improve identity if one exists; otherwise identity resolves as Public. |
| Registered Email OTP | Visitor must prove control of a verified registry email. The registry identity is used for routing. |

For `Registered Email OTP`, `allow_public_fallback` can be enabled to let unregistered but OTP-verified emails continue as `Public`.

### 3. Category Identity Route

`Nexus Category Identity Route` maps the selected category and resolved identity to a profile:

```
channel + chat_category + identity_type → Nexus AI Agent Profile
```

This lets the same chat category route differently for different users. For example:

| Chat Category | Identity Type | Profile |
|---|---|---|
| Product Support | Public | Public Support Bot |
| Product Support | Customer | Customer Support Bot |
| Product Support | Internal | Internal Support Bot |

The route is not an access grant. It only selects the profile that should answer for this category and identity.

### 4. Identity Registry Safe Guard

`Nexus Identity Registry` holds the verified person behind the chat. Its parent-level **Safe Guard** section lists the maximum access categories this verified person may use.

```
Nexus Identity Registry → Safe Guard Access Categories
```

This avoids scattering access limits across each identity row. A person may resolve as several identity types, but the person-level safeguard stays in one place.

### 5. AI Agent Profile Access Category

`Nexus AI Agent Profile Access Category` maps the resolved profile to one or more access categories. The same `Nexus AI Agent Profile` may be linked to multiple categories when the agent needs access to several policy bundles.

```
Nexus AI Agent Profile → Nexus Access Category
```

The effective access categories for a profile are all enabled assignment records for that profile.

### 6. Access Policies

Each `Nexus Access Category` contains child rows in `Nexus Access Category Policy`.

```
Nexus Access Category → Nexus Access Policy
```

The profile policy set is the union of policies from all enabled access categories assigned to that profile.

For category-routed chat, the final retrieval policy set is:

```
Profile Policies ∩ Identity Registry Safe Guard Policies ∩ Identity Cap
```

If the intersection is empty, retrieval is denied. This prevents a route mistake from exposing broad profile access to a narrower person. Example: a customer registry safeguarded to `Customer Access` will not receive internal policies even if the selected route accidentally points to an internal profile.

---

## Runtime Flow

Use **Nexus Chat Workflow Tester** (`/nexus-chat-workflow-tester`) to preview the chain manually without sending an OTP or starting a real conversation.

### Start Chat

`start_live_chat(payload)` must perform this sequence:

```
logged-in internal System User?
    ├─ yes → load active Nexus User Profile Assignment
    │       → load assigned Nexus AI Agent Profile
    │       → System Manager without assignment may continue with default behavior
    └─ no  → payload.chat_category
            ↓
            resolve_identity_type(payload)
            ↓
            resolve_behavior_from_chat_category(chat_category, identity_type, is_authenticated)
            ↓
            load Nexus AI Agent Profile from Nexus Category Identity Route
    ↓
create Nexus Live Conversation with assigned_ai_agent_profile snapshot
    ↓
continue_live_chat(conversation_id, payload)
```

The profile snapshot is important. Follow-up messages should use the same profile as the first message, even if admin configuration changes during the conversation.

For `System Manager` sessions, Core grants all enabled access policies unless the request is public-only. This is an admin bypass of policy narrowing, not a public visitor bypass.

### Continue Chat

`continue_live_chat(conversation_id, payload)` must:

```
load conversation
    ↓
resolve profile from conversation.assigned_ai_agent_profile
    ↓
build ai_profile dict
    ↓
resolve allowed_access_policies from ai_profile.name
    ↓
call digitz_ai_nexus.services.answer_service.answer_query
```

The key ordering rule is:

```
ai_profile must be built before resolve_allowed_policies() is called
```

If access resolution runs without `ai_profile.name`, Nexus Core returns an empty policy list and retrieval fails closed.

---

## Core Query Contract

The payload sent from Live to Nexus Core must include:

```json
{
  "query": "What is my warranty coverage?",
  "response_mode": "chat",
  "channel": "WEBSITE-CHAT",
  "conversation_id": "ABC123",
  "identity_type": "Customer",
  "chat_category": "PRODUCT-SUPPORT",
  "ai_profile": {
    "name": "Customer Support Bot",
    "behavior_prompt": "...",
    "tone": "Professional",
    "response_style": "Balanced",
    "fallback_message": "...",
    "do_not_answer_rules": "...",
    "confidence_threshold": 0.65,
    "escalation_enabled": 1,
    "memory_mode": "Session",
    "default_response_mode": "chat"
  },
  "allowed_access_policies": [
    "Public",
    "Customer Support",
    "Warranty"
  ]
}
```

`allowed_access_policies` must be derived from `ai_profile.name`, not from channel role, Frappe role, or category label.

---

## Public Access Guardrail

Current Nexus Core behavior supports a public guardrail:

```
force_public_only = true → allowed_access_policies = ["Public"]
```

If public chat should only ever retrieve public knowledge, keep this guardrail enabled for guest requests. In that mode, the category-selected profile still controls behavior and conversation snapshot, but access is capped to `Public`.

If the product requirement is that public visitors can receive profile-specific policies through a selected category, then Live must not set `force_public_only` for those category-routed chat requests. Instead, configure the `Public` identity route profile with only the access categories that public visitors may use.

---

## Implementation Status

All items below are implemented and active in the runtime.

- `Nexus Chat Category` DocType.
- `Nexus Category Identity Route` DocType for category + identity → profile routing.
- `Nexus AI Agent Profile Access Category` DocType.
- Identity resolution service.
- Chat category + identity profile resolver (`profile_resolver.resolve_behavior_from_chat_category`).
- Identity Safe Guard intersection in `access_resolver.resolve_allowed_policies`.
- Hard identity cap for `Public` identity.
- `chat_category`, `resolved_identity_type`, `assigned_ai_agent_profile`, and identity safeguard categories stored on `Nexus Live Conversation` at creation — follow-up messages use the same boundary.
- `build_core_chat_payload()` builds `ai_profile` before calling `resolve_allowed_policies()`.
- Admin pages/APIs for chat categories, category routes, profile access allocation, and chain preview.
- Default seed creates a `Public` identity route whose profile has `Public Access`.

---

## Acceptance Checklist

[x] Guest selects a public chat category and resolves to the configured Public identity route.
[x] Customer selects the same category and resolves to the Customer identity route.
[x] The conversation stores `assigned_ai_agent_profile`.
[x] Follow-up messages use the conversation profile snapshot.
[x] The core payload includes `ai_profile.name` before access resolution.
[x] `allowed_access_policies` matches profile access categories intersected with identity safeguard and identity cap.
[x] Empty or missing profile access categories fail closed.
[x] A missing category identity route returns a clear configuration error.
[ ] Automated tests cover the category → identity → profile → policy chain.
