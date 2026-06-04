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

Formal identity registration is handled by `Nexus Identity Registry`. One registry record represents the real person or party joining chat, usually keyed by verified email and optionally linked to `User`, `Customer`, and `Contact`.

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

### 4. AI Agent Profile Access Category

`Nexus AI Agent Profile Access Category` maps the resolved profile to one or more access categories. The same `Nexus AI Agent Profile` may be linked to multiple categories when the agent needs access to several policy bundles.

```
Nexus AI Agent Profile → Nexus Access Category
```

The effective access categories for a profile are all enabled assignment records for that profile.

### 5. Access Policies

Each `Nexus Access Category` contains child rows in `Nexus Access Category Policy`.

```
Nexus Access Category → Nexus Access Policy
```

The final policy set for a profile is the union of policies from all enabled access categories assigned to that profile.

---

## Runtime Flow

### Start Chat

`start_live_chat(payload)` must perform this sequence:

```
payload.chat_category
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

## Current Implementation Status

Implemented:

- `Nexus Chat Category` DocType.
- `Nexus Category Identity Route` DocType.
- `Nexus AI Agent Profile Access Category` DocType.
- Identity resolution service.
- Chat category + identity profile resolver.
- Profile snapshot on `Nexus Live Conversation`.
- Admin pages/APIs for chat categories, category routes, and profile access allocation.
- Chain preview APIs showing identity → profile → access categories → policies.

Needs runtime alignment:

- `build_core_chat_payload()` must build `ai_profile` before calling `resolve_allowed_policies()`.
- The call to `resolve_allowed_policies()` must receive `{"ai_profile": {"name": ...}}`.
- Tests should assert that a selected chat category and identity produce the expected `allowed_access_policies` in the core payload.

---

## Acceptance Checklist

[ ] Guest selects a public chat category and resolves to the configured Public identity route.
[ ] Customer selects the same category and resolves to the Customer identity route.
[ ] The conversation stores `assigned_ai_agent_profile`.
[ ] Follow-up messages use the conversation profile snapshot.
[ ] The core payload includes `ai_profile.name` before access resolution.
[ ] `allowed_access_policies` matches the profile's access categories and policies.
[ ] Empty or missing profile access categories fail closed.
[ ] A missing category identity route returns a clear configuration error.
[ ] Automated tests cover the category → identity → profile → policy chain.
