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

### Agent and Profile

| DocType | Name | Purpose |
|---|---|---|
| Nexus Live Agent | `PUBLIC-AI-ASSISTANT` | Default public AI responder |
| Nexus AI Agent Profile | generated name | Behaviour and access authority for the public assistant |

The profile is assigned:

| Access Category |
|---|
| `Public Access` |

So this profile can retrieve only knowledge chunks whose policy is allowed by `Public Access`.

### Category Route

The default runtime route is:

```text
WEBSITE-CHAT + GENERAL-SUPPORT + Public
    -> PUBLIC-AI-ASSISTANT profile
    -> profile access: Public Access
    -> Public policy
```

Use **Nexus Chat Workflow Tester** to verify this route.

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
| Customer support | Customer identity registry row, customer access policy/category, customer AI profile route |
| Partner support | Partner identity registry row, partner policy/category, partner route |
| Internal desk assistant | Internal AI profile, internal access category, user profile assignment |
| Registered email flow | Chat Category with `Registered Email OTP`, Identity Registry records, route per resolved identity |

Keep the rule simple: every identity that can select a category needs an enabled route to an AI profile, and that profile needs at least one enabled access category. For registered identities, configure the parent registry Safe Guard so runtime can intersect the person's allowed categories with the profile access categories.
