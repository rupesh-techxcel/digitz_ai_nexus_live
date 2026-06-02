# Configuration

---

## Initial Setup Checklist

After installing `digitz_ai_nexus_live`, complete these steps before routing live traffic:

1. **Create at least one `Nexus AI Behaviour`** — configure tone, response style, and confidence threshold.
2. **Create AI agents** — link each agent to a behaviour profile and assign a role.
3. **Create channels** — set `channel_type`, link a `default_agent`, and configure `public_access` and `agent_based` flags.
4. **Create escalation rules** — one rule per agent role that should be able to escalate. Link to a `Nexus Agent Queue`.
5. **Assign human agents to queues** — create `Nexus Queue Assignment` records linking human agents to queues.
6. **Create a `Nexus Live Experience`** (optional) — bundle Q&A and chat configurations for a deployment.

---

## Channel Configuration

Each channel has two key flags:

| Flag | Effect |
|---|---|
| `public_access = True` | Forces `force_public_only` on all queries — only Public knowledge is retrieved |
| `agent_based = True` | Enables agent routing logic; if False, queries use a simple static profile |

For a public website widget, set both to `True`.

For an internal desk channel, set `public_access = False` to allow authenticated access categories.

---

## Experience Bundles

An experience bundle (`Nexus Live Experience`) groups:
- A `Nexus Q And A Configuration` — default channel, agent, welcome message, source display
- A `Nexus Chat Configuration` — default channel, agent, input placeholder, agent name display
- Branding JSON — color, logo, layout overrides

Bundles are identified by `experience_code` and used by front-end widget integrations to pull all configuration in one call.

---

## Escalation Configuration

Escalation requires:
1. A `Nexus Escalation Rule` per agent role (e.g. one for `Public Responder`, one for `Sales`)
2. Each rule pointing to a `Nexus Agent Queue`
3. Human agents assigned to those queues via `Nexus Queue Assignment`

Without a rule for a role, escalation raises an error when triggered for that role. Set `escalation_enabled = False` on the `Nexus AI Behaviour` to suppress escalation entirely for an agent.

---

## Confidence Threshold Tuning

The confidence threshold on `Nexus AI Behaviour` controls how aggressively the system escalates. Starting values by role:

| Role | Suggested Threshold |
|---|---|
| Public Responder | 0.50 — tolerant; public knowledge coverage may be limited |
| Sales | 0.65 — standard; escalate to human for pricing edge cases |
| Support | 0.70 — strict; support answers must be reliable |
| Consultant | 0.60 — moderate; advisory queries can tolerate some uncertainty |

Lower values allow the AI to answer more aggressively; higher values escalate earlier.

---

## Development Commands

```bash
# After DocType JSON changes
bench --site your-site.local migrate
bench --site your-site.local clear-cache

# Test a live Q&A query from the shell
bench --site your-site.local execute \
  "digitz_ai_nexus_live.services.live_qa_service.ask_live_question" \
  --kwargs '{"payload": {"query": "What is the return policy?", "channel": "Website"}}'

# Run app tests
bench --site your-site.local run-tests --app digitz_ai_nexus_live
```
