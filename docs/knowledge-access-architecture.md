# Knowledge and Identity Access Architecture

This document describes how knowledge is stored, organised, and accessed in Nexus — covering
the full chain from knowledge chunks through access policies to identity-based resolution.

---

## 1. How Knowledge is Organised

Knowledge is stored as chunks and every chunk carries a single access stamp that determines
who can retrieve it.

### The Access Chain

```
Nexus Knowledge Unit          ← source content, authored by admin
    access_policy ──────────► Nexus Access Policy     ← the named gate stamped on each chunk
    sensitivity               (e.g. "Public", "Internal", "HR")
         │
         ▼
Nexus Knowledge Chunk         ← vector-embedded piece, inherits access_policy
    access_policy ──────────► Nexus Access Policy     ← used as the retrieval filter key
```

### Grouping Policies into Profiles

Policies are grouped upward into profiles for assignment:

```
Nexus Access Policy
    ▲
    │ (via Nexus Access Category Policy — child table row)
Nexus Access Category          ← groups multiple policies
    ▲
    │ (via Knowledge Profile Access Category — child table row)
Knowledge Profile              ← reusable bundle of access categories
```

A `Knowledge Profile` holds multiple `Nexus Access Category` records.
Each category holds multiple `Nexus Access Policy` records.
A chunk's `access_policy` field is the final retrieval filter.

### Policy Types

`Nexus Access Policy` has an `is_primitive` flag.

| Policy | Type | Notes |
|---|---|---|
| Public | Primitive | The only primitive type. Hard-coded bypass for unregistered visitors. |
| Internal | Default | For desk users and internal staff. |
| Administration | Default | Administrative knowledge. |
| HR | Default | HR-restricted knowledge. |
| Finance | Default | Finance-restricted knowledge. |
| Customer | Default | Customer-facing knowledge. |
| Partner | Default | Partner-facing knowledge. |

Default types have corresponding `Nexus Access Category` records pre-seeded in the system.

---

## 2. Knowledge Access Mechanisms

Two default mechanisms exist for serving knowledge:

| Mechanism | Medium | Category DocType |
|---|---|---|
| Chat | Real-time conversational AI | Nexus Chat Category |
| Q&A | Synchronous query-answer | Nexus Live Channel (direct) |

`Nexus Live Channel` carries an `access_type` field (`Chat` or `Q&A`) that determines which
mechanism applies on that channel. Chat access routes through a `Nexus Chat Category`.
Q&A access is served directly from the channel.

---

## 3. Identity System

Every person who accesses knowledge in Nexus has an identity — visitors, desk users, and
human agents who take over escalated conversations are all treated the same way.

### Nexus Identity Type

Represents the class of identity (e.g. Public, Customer, Partner, Internal, Admin).

| Field | Purpose |
|---|---|
| `title` | Display name of the identity class |
| `enabled` | Whether this identity type is active |
| `sort_order` | Display ordering |
| `safeguard_access_categories` | Child table of `Nexus Access Category` — hard cap applied to all holders of this identity type |

The **safeguard** is a system-level cap: regardless of what a person's Knowledge Profile grants,
they can never access policies outside the safeguard categories defined on their identity type.
This is intentionally uniform — individual overrides are not supported.

### Nexus Identity Profile  *(new)*

A reusable bundle that maps identity types to knowledge profiles. One profile can be assigned
to many people in the Identity Registry.

```
Nexus Identity Profile
    profile_name
    title
    enabled
    description
    │
    └── child table rows:
          identity_type   → Nexus Identity Type
          knowledge_profile → Knowledge Profile
```

A single Identity Profile can carry multiple rows — one per identity type the holder may
be verified as. This allows one profile to serve a person who is both a Customer and a Partner
depending on how they were verified in a given session.

### Nexus Identity Registry

The individual person record. Desk users, registered visitors, and human agents all have
an entry here.

| Field | Notes |
|---|---|
| `email` | Primary identifier for registered visitors |
| `full_name` | Display name |
| `user` | Optional. Set for desk users and agents; used to find the registry entry from a Frappe session |
| `enabled` | Whether this person is active |
| `verification_status` | Unverified / Verified / Blocked |
| `verified_on` | Datetime of last successful OTP verification |
| `reference_doctype` / `reference_name` | Optional link to a CRM or ERP record |
| `contact` | Optional link to Frappe Contact |
| `identity_profiles` | Child table of assigned `Nexus Identity Profile` records |
| `notes` | Free-text notes |

**Public visitors** have no registry entry. The system handles them through the Public bypass
path (see Section 5).

**Desk users** are found by matching `registry.user` to `frappe.session.user`. No OTP is needed;
the Frappe session itself is the authentication.

**Registered visitors** are found by email. Verification is by email OTP for non-Frappe users.

---

## 4. Channel and Category Routing

### Nexus Category Identity Route

The association that connects a chat category and channel to an AI agent and the set of
permitted Identity Profiles.

| Field | Purpose |
|---|---|
| `channel` | Link → Nexus Live Channel |
| `chat_category` | Link → Nexus Chat Category |
| `ai_agent_profile` | Link → Nexus AI Agent Profile — governs AI behavior (tone, fallback, escalation, model config) |
| `enabled` | Whether this route is active |
| `priority` | Lower number = higher priority when multiple routes match |
| `identity_profiles` | Child table of permitted `Nexus Identity Profile` records |

The `ai_agent_profile` controls **how** the AI responds (behavior configuration).
The `identity_profiles` child table controls **who** can access and **what** knowledge they can retrieve.

> **Admin responsibility:** The identity profiles listed on a route should be configured
> meaningfully. The system will intersect the visitor's assigned profiles against the route's
> permitted profiles at runtime. Listing many unrelated profiles increases lookup cost.

### How a Route is Selected

1. Visitor selects a chat category on a channel.
2. System queries `Nexus Category Identity Route` filtered by `channel + chat_category + enabled = 1`.
3. The first matching route (ordered by priority) is used.
4. The route's `ai_agent_profile` is loaded for AI behavior.
5. The route's `identity_profiles` child table is used to resolve knowledge access.

---

## 5. Access Resolution at Query Time

### Path A — Public Visitor (no registry entry, identity_type = "Public")

```
Visitor arrives with no session, no OTP, not in registry
    │
    ▼
identity_type = "Public"  (resolved by resolve_identity_type)
    │
    ▼
force_public_only = True
    │
    ▼
allowed_access_policies = ["Public"]   ← hard bypass, no profile lookup
    │
    ▼
Retrieval filter: access_policy IN ("Public")
```

No Identity Profile, no Knowledge Profile, no safeguard intersection. All chunks stamped
`access_policy = "Public"` are returned.

---

### Path B — Registered Visitor or Desk User

```
Session starts (OTP verified visitor OR authenticated desk user)
    │
    ▼
resolve_identity_type(payload)
    Visitors: from OTP challenge result or registered identity
    Desk users: from frappe.session.user → user_type → "Internal" / "Admin"
    │
    ▼
Find Nexus Identity Registry entry
    Visitors: by email
    Desk users: by frappe_user = frappe.session.user
    │
    ▼
Get all Identity Profiles assigned to this person (registry.identity_profiles)
    │
    ▼
Intersect with route's permitted Identity Profiles
    (identity_profiles from Nexus Category Identity Route)
    │
    ▼
From matched Identity Profiles:
    → find rows where identity_type = session identity_type
    → collect all linked Knowledge Profiles
    │
    ▼
Union all Knowledge Profile policies
    (if same identity type maps to multiple Knowledge Profiles → take all)
    │
    ▼
Apply Identity Type safeguard cap (INTERSECTION)
    Nexus Identity Type.safeguard_access_categories → resolve policies
    allowed = union_policies ∩ safeguard_policies
    │
    ▼
Retrieval filter: access_policy IN (allowed_access_policies)
```

---

### Resolution Summary

| Scenario | Knowledge Profile source | Safeguard cap | Result |
|---|---|---|---|
| Public visitor | None | None | ["Public"] only |
| Registered visitor (Customer) | Identity Profile rows for "Customer" identity type | Identity Type "Customer" safeguard | Union of Customer profiles ∩ safeguard |
| Desk user (Internal) | Identity Profile rows for "Internal" identity type | Identity Type "Internal" safeguard | Union of Internal profiles ∩ safeguard |
| Admin (System Manager) | All enabled policies | None | Unrestricted |
| Human agent | Identity Profile rows for their identity type | Identity Type safeguard | Same as registered visitor path |

---

## 6. DocType Map

### Knowledge Layer

| DocType | Role |
|---|---|
| `Nexus Knowledge Unit` | Source content. Has `access_policy` and `sensitivity`. |
| `Nexus Knowledge Chunk` | Vector-embedded piece. `access_policy` is the retrieval filter key. |
| `Nexus Access Policy` | Named access gate. `is_primitive = 1` for "Public". |
| `Nexus Access Category Policy` | Child table row: links one policy into an access category. |
| `Nexus Access Category` | Groups multiple policies via `allowed_policies` child table. |
| `Knowledge Profile Access Category` | Child table row: links one access category into a knowledge profile. |
| `Knowledge Profile` | Reusable bundle of access categories. Assigned to Identity Profiles. |

### Identity Layer

| DocType | Role |
|---|---|
| `Nexus Identity Type` | Named identity class. Holds `safeguard_access_categories` child table. |
| `Nexus Identity Profile` | Maps identity types to knowledge profiles. Reusable across registry entries. |
| `Nexus Identity Registry` | Individual person record. Holds assigned Identity Profiles. |

### Routing Layer

| DocType | Role |
|---|---|
| `Nexus Live Channel` | The delivery medium. `access_type` = Chat or Q&A. |
| `Nexus Chat Category` | Chat-specific category. Routes through `Nexus Category Identity Route`. |
| `Nexus Category Identity Route` | Binds category + channel → AI agent profile + permitted identity profiles. |
| `Nexus AI Agent Profile` | AI behavior config (tone, fallback, thresholds). No longer controls knowledge access. |

---

## 7. What Changed from the Previous Model

| Concern | Old | New |
|---|---|---|
| Knowledge access config | On `Nexus AI Agent Profile` (knowledge_profile field) | On `Nexus Identity Profile` (per identity type) |
| Per-person knowledge access | Via Nexus User Profile Assignment (desk) or Category Route (visitors) | Unified: `Nexus Identity Registry` + `Nexus Identity Profile` for all accessor types |
| Safeguard access cap | On `Nexus Identity Registry` (per person) | On `Nexus Identity Type` (per identity class) |
| Desk user access | `Nexus User Profile Assignment` → knowledge_profile | `Nexus Identity Registry` entry with `registry.user = frappe_username`, assigned Identity Profiles |
| Category route identity control | One `identity_type` → one `ai_agent_profile` per route | Child table of permitted Identity Profiles per route; AI behavior still via `ai_agent_profile` |
| Public access | `force_public_only` from user_type check | Same mechanism, formalised: Public identity type = bypass, returns all Public chunks |
| Multiple knowledge profiles (same identity type) | Not possible | Union of all matching Knowledge Profile policies |
