# DIGITZ AI Nexus Live

**Live conversation runtime for the DIGITZ AI platform** — built on [Frappe Framework](https://frappeframework.com).

This app is the real-time conversation layer of the platform. It manages AI and human agents, routes queries to the right agent, maintains conversation history, and escalates sessions when confidence drops or a human is requested. It does **not** contain retrieval or prompt logic — that lives in `digitz_ai_nexus`.

---

## App Family

| App | Role |
|---|---|
| `digitz_ai_nexus` | AI core: knowledge, access governance, retrieval, answer engine |
| `digitz_ai_nexus_live` | Live conversation runtime: chat, escalation, human handover |
| `digitz_ai_nexus_experience` | Testing and validation: test cases, synthetic data, platform validation |

---

## What This App Does

`digitz_ai_nexus_live` is responsible for:

- **Agent registry** — define AI and human agents with roles, behaviors, availability, and channel defaults
- **Behavior profiles** — configure tone, style, confidence thresholds, escalation rules, and memory mode per agent
- **Channel management** — Website Q&A, Website Chat, Desk, Portal, API, and WhatsApp channels
- **Conversation lifecycle** — create, continue, escalate, hand over, and close conversations
- **Intelligent routing** — assign agents by role inference, explicit request, or channel default
- **Escalation management** — trigger escalation based on confidence threshold, no-knowledge, or user request
- **Experience bundles** — group Q&A and chat configuration into named experience deployments
- **Analytics** — interaction logs, conversation outcomes, lead capture, and agent performance snapshots
- **Visitor data analytics** — purpose-specific name and email capture with conversation context, verification, and permitted-use scope

---

## Key Concepts

### Agents

Every conversation is handled by an agent. Agents have a type (AI or Human), a role, and a profile-driven behavior configuration:

```
Nexus Live Agent
├── agent_type: AI | Human
├── agent_role: Public Responder | Sales | Support | Consultant | Internal Assistant | Admin Reviewer
└── Nexus AI Agent Profile (behavior + access authority)
```

Behavior resolution priority:
1. `Nexus AI Agent Profile` resolved from chat category, conversation snapshot, user assignment, or agent profile
2. No agent-level behaviour fallback is used

AI agents answer queries through Nexus Core. Human agents receive escalated conversations.

### Conversations

A conversation tracks a full session between a visitor and an agent:

```
Nexus Live Conversation
├── conversation_type: Q&A | Chat
├── status: Open → Responding → Escalated → Handed Over → Closed
├── Nexus Live Message (1:many)
└── Nexus Conversation Participant (1:many)
```

Q&A conversations are stateless single-exchange queries. Chat conversations maintain history across messages for context continuity.

### Escalation

Escalation is triggered automatically when confidence drops below the rule threshold, when the retrieval engine finds no knowledge, or when a user explicitly requests a human. The escalation flow:

```
Confidence < threshold OR no_knowledge OR user_requested_human
    → Look up Nexus Escalation Rule by agent_role
    → Find target Nexus Agent Queue
    → Select available human agent from queue
    → Update conversation status = "Escalated"
    → Create Nexus Live Escalation record
```

### Channels

Channels define the entry point for a conversation. Each channel can have routing rules and a default agent. The `agent_based` flag determines whether the channel uses agent routing logic or falls back to a simple profile-based query.

---

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture.md) | App structure, data flow, service layer, integration points |
| [Chat Category Identity Access Workflow](docs/chat-category-identity-access-workflow.md) | Category + identity routing to profile, access categories, policies, and chunk retrieval |
| [Agent Management](docs/agent-management.md) | Agent lifecycle, behavior profiles, routing, availability |
| [Conversation Flow](docs/conversation-flow.md) | Chat and Q&A lifecycle, context continuity, message history |
| [Escalation](docs/escalation.md) | Escalation rules, queues, confidence thresholds, handover flow |
| [Default Seed Data](docs/default-seed-data.md) | Installed default tenant, access policies, identity types, public chat route, and first-run validation |
| [DocType Reference](docs/doctypes.md) | All DocTypes with fields, autoname, and purpose |
| [API Reference](docs/api-reference.md) | All whitelisted endpoints and payload contracts |
| [Configuration](docs/configuration.md) | Experience bundles, channel setup, development commands |
| [Nexus Data Analytics](docs/nexus-data-analytics.md) | Contextual visitor contact capture, feeds, deduplication, and permitted-use controls |

---

## Installation

```bash
bench get-app digitz_ai_nexus_live
bench --site your-site.local install-app digitz_ai_nexus_live
bench --site your-site.local migrate
```

Requires Frappe Framework v15+ and `digitz_ai_nexus` to be installed first.

---

## Development

```bash
# After DocType JSON changes
bench --site your-site.local migrate
bench --site your-site.local clear-cache

# Run tests
bench --site your-site.local run-tests --app digitz_ai_nexus_live
```

---

## License

See [license.txt](license.txt). Built by [Techxcel Technologies](mailto:rupesh@techxceltech.com).
