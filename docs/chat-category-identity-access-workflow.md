# Chat Category, Identity, and Access Workflow

This document is the working contract for how a visitor's chat request travels from category
selection through identity resolution to knowledge access.

```
visitor chat request
  → chat category selected by the user
  → identity type resolved for the user
  → route selected: category + channel → AI Agent Profile + permitted Identity Profiles
  → Knowledge Profiles resolved from person's Identity Profiles (intersected with route)
  → Access Policies unioned from Knowledge Profiles
  → Identity Type safeguard cap applied
  → knowledge chunks filtered by allowed policies
```

---

## Configuration Chain

### 1. Chat Category

`Nexus Chat Category` is the option shown in the chat UI, such as Customer Support, Product
Enquiry, or Sales.

| Field | Purpose |
|---|---|
| `category_code` | Stable category identifier |
| `category_label` | Display label shown to the user |
| `channel` | Live channel this category belongs to |
| `visibility` | Select: **External** (public widget only) / **Internal** (desk chat only) / **Both** (both interfaces). Controls which interface surfaces this category. `_send_category_picker` filters by this field: public widget shows External + Both; internal desk chat shows Internal + Both. |
| `identity_verification_mode` | Whether the category needs email OTP before chat starts |
| `allow_public_fallback` | For Registered Email OTP, allow unregistered verified emails to continue as Public |
| `enabled` | Controls visibility |

The category does not grant access by itself. It only selects a route.

---

### 2. Identity Type

`identity_type` identifies who is asking. It is a Link to `Nexus Identity Type`.

Seeded defaults:

```
Public    Customer    Prospect    Partner    Internal    Admin
```

Runtime resolution is in `digitz_ai_nexus_live.services.identity_resolver.resolve_identity_type`.

**Resolution priority:**

1. Trusted `identity_type` in payload (`trust_payload_identity = True`) — server-side integrations only.
2. Verified OTP challenge.
3. Registry blocked check (throws if blocked).
4. Frappe session user type — Website User → `Customer`; System User → `Admin` (System Manager) or `Internal`.
5. `api_scope` field — `partner` → `Partner`; `prospect` → `Prospect`.
6. Default: `Public`.

Blocked registry records are denied. Unverified registries are not elevated.

**Category verification modes:**

| Mode | Meaning |
|---|---|
| None | No OTP required |
| Email OTP | Visitor proves email control; registry may improve identity |
| Registered Email OTP | Visitor must prove a verified registry email |

---

### 3. Category Identity Route

`Nexus Category Identity Route` maps the selected category and channel to an AI Agent Profile
and a set of **permitted Identity Profiles**.

| Field | Purpose |
|---|---|
| `channel` | Link → Nexus Live Channel |
| `chat_category` | Link → Nexus Chat Category |
| `ai_agent_profile` | AI behavior config (tone, fallback, escalation, thresholds) |
| `identity_profiles` | Child table of permitted `Nexus Identity Profile` records |
| `enabled` | Active flag |
| `priority` | Lower = higher priority when multiple routes match |

**Important separation of concerns:**

- `ai_agent_profile` controls **how** the AI responds — it is behavior-only.
- `identity_profiles` controls **who** can access and **what knowledge** they can retrieve.

**Two route types:**

| Route type | `open_to_all` | Knowledge |
|---|---|---|
| Public route | `True` (no identity_profiles configured) | Returns `["Public"]` only — no Identity Profile matching performed |
| Registered route | `False` (identity_profiles present) | Intersects visitor's identity profiles with route's permitted profiles |

`open_to_all` is derived at runtime as `not bool(identity_profiles)` — a route with an empty `identity_profiles` child table is automatically open to all Public visitors. There is no separate boolean field.

The route does not directly own knowledge. Knowledge access is resolved through Identity Profiles
assigned to the person (see Section 5).

---

### 4. Identity Profile

`Nexus Identity Profile` is a **reusable bundle** that maps identity types to Knowledge Profiles.
One profile can be assigned to many people via the Identity Registry.

```
Nexus Identity Profile
  profile_name, title, enabled
  identity_mappings (child table):
    identity_type   → Nexus Identity Type
    knowledge_profile → Knowledge Profile
```

A single Identity Profile can carry multiple rows — one per identity type the holder may be
verified as. This allows one profile to serve a person who is both a Customer and a Partner.

---

### 5. Identity Registry

`Nexus Identity Registry` is the individual person record. It holds one or more assigned
`Nexus Identity Profile` records (with validity dates).

The registry is found by:
- Frappe session user → `registry.user` field (desk users)
- Verified OTP challenge → linked `identity_registry`
- Trusted visitor email (`trust_visitor_email = True`)

---

### 6. Knowledge Profiles and Access Policies

```
Knowledge Profile
  access_categories (child table):
    Nexus Access Category
      allowed_policies (child table):
        Nexus Access Policy
```

A `Knowledge Profile` groups multiple `Nexus Access Category` records.
Each category holds multiple `Nexus Access Policy` records.
A chunk's `access_policy` field is the final retrieval filter.

---

### 7. Identity Type Safeguard Cap

`Nexus Identity Type.safeguard_access_categories` holds a hard cap applied uniformly to all
holders of that identity class.

This is a **system-level, class-wide cap** — not a per-person limit. Individual overrides
are not supported by design.

```
Identity Type "Customer" → safeguard_access_categories → ["Customer Access", "Public Access"]
```

Any holder of the `Customer` identity type can never retrieve policies outside those categories,
regardless of what their Knowledge Profile grants.

---

## Runtime Flow

### Start Chat — Visitor Path

```
start_live_chat(payload)
│
├── 1. apply_session_user_context(payload)
│
├── 2. If chat_category: enforce_category_verification(payload)
│       OTP check → sets payload.identity_registry if verified
│
├── 3. apply_tenant_context_to_payload(payload)
│
├── 4. If chat_category:
│   ├── resolve_identity_type(payload)
│   │
│   ├── resolve_behavior_from_chat_category(category, identity_type, is_authenticated, payload)
│   │       Public identity:
│   │         → find route where open_to_all = not bool(identity_profiles)
│   │         → knowledge_profile_names = []
│   │       Registered identity:
│   │         → find person's registry
│   │         → get active identity profiles
│   │         → intersect with route's permitted identity_profiles
│   │         → collect knowledge_profile for matching identity_type
│   │         → union → knowledge_profile_names
│   │       Returns behavior dict including knowledge_profile_names
│   │
│   ├── resolve_identity_registry_name(payload)
│   └── resolve_identity_safeguard_access_categories(payload)
│           Reads from Nexus Identity Type (not registry)
│           Stored as identity_safeguard_access_json on conversation
│
├── 5. assign_agent(payload)
│
├── 6. create_conversation(payload, agent, ai_profile_override)
│       ai_profile_snapshot_json includes knowledge_profile_names
│
└── 7. Return conversation_id + status
```

### Continue Chat — Follow-up Messages

```
send_chat_message(conversation_id, payload)
│
├── 1. load conversation
│
├── 2. enrich_payload_from_conversation(payload, conversation)
│       Restores: tenant, channel, chat_category, identity_type,
│                 identity_registry, identity_safeguard_access_categories
│
└── 3. _process_ai_response() (background job)
        │
        ├── _resolve_behavior(payload, conversation)
        │       → resolve_behavior_from_conversation(conversation)
        │           reads ai_profile_snapshot_json → restores knowledge_profile_names
        │
        ├── build_core_chat_payload()
        │       → _build_ai_profile_dict(behavior)
        │           includes knowledge_profile_names list
        │       → resolve_allowed_policies({..., ai_profile: { knowledge_profile_names }})
        │
        └── answer_query(core_payload)
```

**Profile and knowledge access are frozen at conversation creation.** The
`ai_profile_snapshot_json` field on the conversation stores `knowledge_profile_names`. Follow-up
messages restore from the snapshot rather than re-resolving. This ensures the same knowledge
boundary is active throughout the whole conversation even if admin configuration changes mid-session.

### Internal / Desk User Path

Desk users resolve knowledge via `Nexus Identity Registry` — the same path as visitors.

```
session_user (Frappe desk user)
    ↓
Nexus Identity Registry (matched by registry.user = frappe.session.user)
    ↓
Active identity profiles on the registry
    ↓
Identity Profile mappings where identity_type = "Internal" | "Admin"
    ↓
knowledge_profile_names list
    ↓
resolve_allowed_policies({knowledge_profile_names})
```

`System Manager` sessions bypass profile narrowing and receive all enabled access policies.

---

## Access Resolution Logic

`engine.access_resolver.resolve_allowed_policies(query_contract)`

```python
# force_public_only  →  allowed = ["Public"]
# System Manager     →  allowed = all enabled policies
# knowledge_profile_names list:
#   policies = union of all knowledge profiles' categories' policies
#   cap = identity_safeguard_access_categories → their policies
#   allowed = policies ∩ cap   (if cap is None → no restriction)
# no knowledge_profile_names →  allowed = []  (fails closed)
```

**force_public_only fires when:**
```
not ai_profile.name AND (identity_type == "Public" OR user_type == "Guest")
```

If a routed AI profile exists, Public visitors use that profile's knowledge access — they are
not forced to Public-only. Only truly unrouted public requests are force-public-only.

---

## Core Query Contract

The payload sent from Live to Nexus Core includes:

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
    "knowledge_profile_names": ["Customer Knowledge", "Warranty Knowledge"],
    "behavior_prompt": "...",
    "tone": "Professional",
    "response_style": "Balanced",
    "fallback_message": "...",
    "do_not_answer_rules": "...",
    "confidence_threshold": 0.65,
    "escalation_enabled": 1,
    "memory_mode": "Session",
    "identity_type": "Customer"
  },
  "allowed_access_policies": [
    "Public",
    "Customer Support",
    "Warranty"
  ]
}
```

`allowed_access_policies` is derived from `ai_profile.knowledge_profile_names`, not from `ai_profile.name`.

---

## Fail-Closed Rules

| Situation | Result |
|---|---|
| No route found for category + identity | Throws — configuration error surfaced to user |
| Route found but no matching identity profiles | `knowledge_profile_names = []` → `allowed_access_policies = []` → retrieval denied |
| Public route | `["Public"]` only |
| Safeguard produces empty intersection | `allowed_access_policies = []` → retrieval denied |
| Registry is Blocked | Throws — access denied |

---

## Admin Configuration Checklist

For each chat category and route:

```
[ ] Nexus Category Identity Route exists for the channel + category combination
[ ] Public route: identity_profiles left empty (open_to_all = True), ai_agent_profile assigned
[ ] Registered routes: permitted identity_profiles configured
[ ] ai_agent_profile has behavior configured (prompt, tone, thresholds)
[ ] Identity Profiles have identity_mappings rows for all relevant identity types
[ ] Each identity_type mapping points to an enabled Knowledge Profile
[ ] Knowledge Profile has at least one enabled Access Category with policies
[ ] Nexus Identity Type safeguard_access_categories configured for all registered types
```

For internal desk users:

```
[ ] Nexus Identity Registry entry exists with registry.user = frappe_username
[ ] Registry is Verified
[ ] Identity Profiles assigned with rows for "Internal" or "Admin" identity type
[ ] Each mapping points to an enabled Knowledge Profile
```
