# Default Seed Data

`digitz_ai_nexus_live` installs a small, usable default workflow so a clean site can start chat validation without manually creating every governance record first.

The seed is idempotent. It creates missing records and updates the baseline defaults when they already exist.

Run it manually on an existing or reset site with:

```bash
bench --site your-site.local execute digitz_ai_nexus_live.setup.install.seed_defaults
```

---

## Why Defaults Exist

The live chat runtime cannot answer only from a channel and message. Before a conversation starts, the system must resolve:

```text
Channel + Chat Category + Identity Type
    -> AI Agent Profile
    -> Access Categories
    -> Access Policies
    -> approved Knowledge Chunks
```

The default seed creates one complete public route through that chain.

---

## Core Defaults

These records are owned by `digitz_ai_nexus` and provide the access and tenant foundation.

### Tenant

| DocType | Name | Purpose |
|---|---|---|
| Nexus Tenant | `DIGITZ-NEXUS` | Default tenant for setup and validation |

### Tenant Configuration Defaults

The Live install seed also creates the tenant runtime defaults used by context resolution:

| DocType | Name | Purpose |
|---|---|---|
| Nexus Business Unit | `Default` | Default business-unit scope |
| Nexus Public Context | `Website Chat` | Default public context for website chat |
| Nexus Tenant Configuration | `Default Live` | Default tenant configuration for `DIGITZ-NEXUS`; sets Q&A and chat channel defaults to `WEBSITE-CHAT` |

`Default Live` is marked enabled and tenant-default. It is intended as a starting point for validation, not a required production naming convention.

### Access Policies

| Policy | Purpose |
|---|---|
| `Public` | Primitive public policy used by public knowledge chunks |
| `Internal` | Example internal policy |
| `Restricted` | Example restricted policy |

Only `Public` is treated as the primitive system policy. `Internal` and `Restricted` are starter examples that can be renamed, removed, or replaced for a real tenant model.

### Access Categories

| Access Category | Policies |
|---|---|
| `Public Access` | `Public` |
| `Internal Access` | `Public`, `Internal` |
| `Restricted Access` | `Public`, `Internal`, `Restricted` |

Runtime retrieval starts from the access categories assigned to the resolved `Nexus AI Agent Profile`. For registered identities, this is narrowed by the parent `Nexus Identity Registry` Safe Guard and any identity hard cap.

---

## Live Defaults

These records are owned by `digitz_ai_nexus_live` and create the first working chat path.

### Identity Types

| Identity Type | Meaning |
|---|---|
| `Public` | Anonymous or unauthenticated visitor |
| `Customer` | Registered customer or portal user |
| `Prospect` | Pre-sales visitor |
| `Partner` | External partner |
| `Internal` | Internal desk user |
| `Admin` | System administrator |

### Live Channel

| DocType | Name | Purpose |
|---|---|---|
| Nexus Live Channel | `WEBSITE-CHAT` | Default website chat channel |

### Chat Category

| DocType | Name | Label | Verification |
|---|---|---|---|
| Nexus Chat Category | `GENERAL-SUPPORT` | General Support | `None` |

This is the category users can select first when testing a fresh setup.

### AI Agent Profile

| DocType | Name | Purpose |
|---|---|---|
| Nexus AI Agent Profile | `PUBLIC-AI-ASSISTANT` | Default public AI agent profile template |

The profile is seeded with:

| Setting | Value |
|---|---|
| `display_name` | Nexus Assistant |
| `nickname_pool` | 25 built-in names (Aria, Nova, Zara … Vera) — one is picked randomly at each session start |
| `agent_role` | Public Responder |
| `escalation_enabled` | 1 |
| Access Category | `Public Access` |

So this profile can retrieve only knowledge chunks whose policy is allowed by `Public Access`.

Each conversation creates a `Nexus AI Agent Profile Instance` from this template. The instance
carries the session nickname shown in the chat widget header.

### Identity Profile

| DocType | Name | Purpose |
|---|---|---|
| Nexus Identity Profile | `DEFAULT-PUBLIC-PROFILE` | Seeded profile for the public category route |

The default identity profile maps the `Public` identity type with no knowledge profile
restriction. It is attached to the seeded public category route so the route resolver can
confirm a valid identity profile exists for public visitors.

### Category Route

The default runtime route is:

```text
WEBSITE-CHAT + GENERAL-SUPPORT
    is_public_route = 1
    -> AI Agent Profile: PUBLIC-AI-ASSISTANT
    -> Profile access: Public Access → Public policy
    -> Identity Profile: DEFAULT-PUBLIC-PROFILE (attached to route)
```

Use **Nexus Chat Workflow Tester** to verify this route.

### Workspace

The install seed also creates the **Nexus Live** Frappe workspace, which links all 9 admin
pages and all key DocTypes in a single organised home page. It is accessible from the desk
sidebar under the `Digitz AI Nexus Live` module.

---

## Expected Verification Result

When testing:

| Input | Value |
|---|---|
| Channel | `WEBSITE-CHAT` |
| Chat Category | `GENERAL-SUPPORT` |
| Identity Type | `Public` |

Expected chain:

```text
Resolved Identity Type: Public
AI Agent Profile: seeded public profile
Access Categories: Public Access
Access Policies: Public
Warnings: none
```

---

## Adding First Test Knowledge

After defaults are present:

1. Create a `Nexus Knowledge Source` under tenant `DIGITZ-NEXUS`.
2. Set its access policy to `Public`.
3. Add simple test content such as a company FAQ.
4. Generate knowledge units and chunks.
5. Approve/publish the chunks if required by the knowledge workflow.
6. Ask a question through the public chat path.

If no approved public knowledge exists, the default assistant should fall back with:

```text
I do not have enough approved knowledge to answer this.
```

---

## Recommended Next Defaults To Add Manually

Once the public route is working, add tenant-specific routes:

| Scenario | Records to add |
|---|---|
| Customer support | Identity Type "Customer" with safeguard, Knowledge Profile for customer content, Identity Profile mapping "Customer" → that Knowledge Profile, Identity Registry for each verified customer, registered route with permitted Identity Profiles |
| Partner support | Same pattern as Customer with "Partner" identity type |
| Internal desk assistant | Identity Registry entry with `user = frappe_username`, Identity Profile mapping "Internal" → internal Knowledge Profile |
| Registered email flow | Chat Category with `Registered Email OTP`, Identity Registry records with Identity Profiles, route with permitted profiles |

Keep the rule simple: every registered visitor needs a `Nexus Identity Registry` entry with assigned `Identity Profiles`. Every Identity Profile needs `identity_mappings` rows linking identity types to Knowledge Profiles. Every Knowledge Profile needs at least one enabled Access Category. For each identity class, configure the `Nexus Identity Type` safeguard.
