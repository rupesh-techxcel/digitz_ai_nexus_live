# Configuration

---

## Initial Setup Checklist

After installing `digitz_ai_nexus_live`, complete these steps before routing live traffic.

### Step 1 — Access Policies and Categories (Nexus Core)

1. Verify `Nexus Access Policy` records exist (seeded on install: PUBLIC, CUSTOMER_RESTRICTED, INTERNAL_EMPLOYEE, etc.)
2. Create `Nexus Access Category` bundles that group the policies your profiles will need.
   Example: "Customer Access" → [Public, Customer Restricted]
3. Make sure knowledge chunks in Nexus Core have `access_policy` values matching these policies.

### Step 2 — AI Agent Profiles

1. Create a `Nexus Live Agent` (type: AI) for each AI responder.
2. Create a `Nexus AI Agent Profile` for each agent — configure behaviour fields (tone, response style, fallback message, escalation settings).
3. Open **Nexus Profile Access Allocation** (`/nexus-profile-access-allocation`) and assign one or more Access Categories to each profile. A profile may hold multiple access categories; runtime access is the union of all enabled categories assigned to that profile.

### Step 3 — Channels, Chat Categories, and Identity Routes

1. Create `Nexus Live Channel` records (Website Chat, Portal, API, etc.).
2. For each channel, open **Nexus Chat Category Manager** (`/nexus-chat-category-manager`) and configure the categories the chat UI should show.
3. Open **Nexus Identity Registry** (`/nexus-identity-registry`) and register known people or parties by verified email. Add one or more identity rows, such as Customer, Partner, or Premium Customer.
4. On each chat category, choose an identity verification mode when needed: `None`, `Email OTP`, or `Registered Email OTP`.
5. Open **Nexus Category Profile Routes** (`/nexus-category-profile-routes`) and map each category + identity type to an AI Agent Profile:

   | Identity Type | Example Label | Example Profile |
   |---|---|---|
   | Public | General Enquiry | Website Public Bot |
   | Customer | Customer Support | Customer Support Bot |
   | Prospect | Connect to Sales | Sales Bot |

   A category with no enabled route for the resolved identity type cannot start a conversation.

6. Use **Nexus Chat Workflow Tester** (`/nexus-chat-workflow-tester`) to verify complete runtime resolution for a sample channel, category, email, and verification state.
7. Use the route chain preview to verify:

   ```
   Chat Category → Identity Type → AI Agent Profile → Access Categories → Access Policies
   ```

   The preview should show every access category linked to the resolved profile, not just a single category.

### Step 4 — Internal User Assignments

1. Open **Nexus User Profile Manager** (`/nexus-user-profile-manager`).
2. For every internal desk user who will query the system, assign an active AI Agent Profile.
3. Verify the assigned profile has an Access Category configured — the page shows a warning if not.

### Step 5 — Escalation

1. Create a `Nexus Escalation Rule` per agent role that should escalate.
2. Each rule must point to a `Nexus Agent Queue`.
3. Assign human agents to queues via `Nexus Queue Assignment`.
4. Set `escalation_enabled` and `escalation_policy` on each `Nexus AI Agent Profile` as required.

### Step 6 — Experience Bundles (optional)

Create a `Nexus Live Experience` to bundle Q&A config, chat config, and branding for a specific deployment.

---

## Admin Pages

| Page | URL | Purpose |
|---|---|---|
| Nexus Profile Access Allocation | `/nexus-profile-access-allocation` | Assign Access Categories to AI Agent Profiles |
| Nexus Identity Registry | `/nexus-identity-registry` | Register verified people/parties and assign one or more identity types |
| Nexus Chat Category Manager | `/nexus-chat-category-manager` | Configure chat window options per channel |
| Nexus Category Profile Routes | `/nexus-category-profile-routes` | Map channel + chat category + identity type to AI Agent Profiles |
| Nexus Chat Workflow Tester | `/nexus-chat-workflow-tester` | Preview category, verification, identity, profile, access categories, and policies |
| Nexus Identity Verification Monitor | `/nexus-identity-verification-monitor` | Inspect email OTP challenges, status, attempts, expiry, and resolved identity |
| Nexus User Profile Manager | `/nexus-user-profile-manager` | Assign profiles to internal desk users |
| Nexus Live Studio | `/nexus-live-studio` | Agent, channel, and behaviour configuration |
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
