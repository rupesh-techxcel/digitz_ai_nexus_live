# Configuration

---

## Initial Setup Checklist

After installing `digitz_ai_nexus_live`, complete these steps before routing live traffic.

### Step 1 — Access Policies and Categories (Nexus Core)

1. Verify `Nexus Access Policy` records exist. The default seed creates `Public`, `Internal`, and `Restricted`.
2. Create `Nexus Access Category` bundles that group the policies your profiles will need.
   Example: "Customer Access" → [Public, Customer]
3. Make sure knowledge chunks in Nexus Core have `access_policy` values matching these policies.

See [Default Seed Data](default-seed-data.md) for the records created by the install seed and the baseline public route.

### Step 2 — AI Agent Profiles

1. Create a `Nexus Live Agent` (type: AI) for each AI responder.
2. Create a `Nexus AI Agent Profile` for each agent — configure **behavior only**: tone, response style, fallback message, escalation settings, confidence threshold.

Knowledge access is configured via Identity Profiles (see Step 3), not on the AI Agent Profile.

### Step 3 — Identity Access Configuration

1. In `Nexus Identity Type`, add `safeguard_access_categories` to cap each identity class (e.g. "Customer" can only access Customer and Public categories).
2. Create `Knowledge Profile` records — each bundles one or more Access Categories.
3. Create `Nexus Identity Profile` records — each maps identity types to Knowledge Profiles. One profile can serve multiple people.
4. In `Nexus Identity Registry`, register each known person (by verified email or Frappe user). Assign the appropriate Identity Profiles with valid date ranges.

### Step 4 — Channels, Chat Categories, and Routes

1. Create `Nexus Live Channel` records (Website Chat, Portal, API, etc.).
2. For each channel, open **Nexus Chat Category Manager** (`/nexus-chat-category-manager`) and configure the categories the chat UI should show.
3. On each chat category, choose an identity verification mode: `None`, `Email OTP`, or `Registered Email OTP`.
4. Open **Nexus Category Profile Routes** (`/nexus-category-profile-routes`) and configure routes:

   | Route type | Config |
   |---|---|
   | Public | Leave `identity_profiles` child table empty (empty = open to all). Assign AI Agent Profile. Knowledge = ["Public"] only. |
   | Registered | Add permitted Identity Profiles to the `identity_profiles` child table. Assign AI Agent Profile. |

   A category with no enabled route cannot start a conversation.

5. Use **Nexus Chat Workflow Tester** (`/nexus-chat-workflow-tester`) to verify complete runtime resolution for a sample channel, category, email, and verification state.
6. Verify the route chain shows:

   ```
   Chat Category → Route → Identity Profiles → Knowledge Profiles → Access Categories → Policies
   ```

### Step 5 — Internal User Access

1. For every internal desk user who needs knowledge access, create a `Nexus Identity Registry` entry with `user = frappe_username` and `verification_status = Verified`.
2. Assign Identity Profiles that have `identity_mappings` rows for `identity_type = "Internal"` or `"Admin"`.
3. `Nexus User Profile Assignment` is only needed for escalation configuration (to receive human escalation alerts).

### Step 5 — Escalation

1. Create a `Nexus Escalation Rule` per agent role that should escalate.
2. Each rule must point to a `Nexus Agent Queue`.
3. Assign human agents to queues via `Nexus Queue Assignment`.
4. Set `escalation_enabled` and `escalation_policy` on each `Nexus AI Agent Profile` as required.

---

## Admin Pages

| Page | URL | Purpose |
|---|---|---|
| Nexus Profile Access Allocation | `/nexus-profile-access-allocation` | Assign Access Categories to AI Agent Profiles |
| Nexus Identity Registry Manager | `/app/nexus-identity-registry-manager` | Register verified people/parties and assign one or more identity types |
| Nexus Chat Category Manager | `/nexus-chat-category-manager` | Configure chat window options per channel |
| Nexus Category Profile Routes | `/nexus-category-profile-routes` | Map channel + chat category + identity type to AI Agent Profiles |
| Nexus Chat Workflow Tester | `/nexus-chat-workflow-tester` | Preview category, verification, identity, profile, access categories, and policies |
| Nexus Identity Verification Monitor | `/nexus-identity-verification-monitor` | Inspect email OTP challenges, status, attempts, expiry, and resolved identity |
| Nexus User Profile Manager | `/app/nexus-user-profile-manager` | Assign profiles to internal desk users |
| Nexus Live Studio | `/nexus-live-studio` | Agent and channel configuration |
| Nexus Live Console | `/nexus-live-console` | Live operations visibility |

---

## Channel Configuration

| Flag | Effect |
|---|---|
| `public_access = True` | Forces `force_public_only` — only Public knowledge retrieved regardless of profile |
| `agent_based = True` | Enables agent routing for Q&A channels; if False, queries use a direct profile lookup |

For a public website widget set `public_access = True`.
For internal desk channels set `public_access = False`.

---

## Escalation Configuration

Escalation requires:
1. A `Nexus Escalation Rule` per agent role
2. Each rule pointing to a `Nexus Agent Queue`
3. Human agents assigned to those queues via `Nexus Queue Assignment`

Control escalation behaviour on each `Nexus AI Agent Profile`:
- `escalation_enabled` — whether this profile may trigger escalation
- `escalation_policy` — which escalation rule to use
- `confidence_threshold` — below this score, escalation is triggered (default 0.65)

Suggested starting values by role:

| Role | Threshold |
|---|---|
| Public Responder | 0.50 — tolerant; public knowledge coverage may be limited |
| Sales | 0.65 — standard |
| Support | 0.70 — strict; support answers must be reliable |
| Consultant | 0.60 — moderate |

---

## Development Commands

```bash
# Recreate/update the default setup records on an existing site
bench --site your-site.local execute digitz_ai_nexus_live.setup.install.seed_defaults

# After DocType JSON changes
bench --site your-site.local migrate
bench --site your-site.local clear-cache

# Test a live Q&A query from the shell
bench --site your-site.local execute \
  "digitz_ai_nexus_live.services.live_qa_service.ask_live_question" \
  --kwargs '{"payload": {"query": "What is the return policy?", "channel": "website-chat"}}'

# Run app tests
bench --site your-site.local run-tests --app digitz_ai_nexus_live
```
