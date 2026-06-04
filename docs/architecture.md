# Architecture Overview

DIGITZ AI Nexus Live is the real-time conversation runtime for the DIGITZ AI platform. It handles agent assignment, conversation lifecycle, escalation, and experience configuration. It does **not** contain retrieval or answer logic — those live in `digitz_ai_nexus`. This app calls into Nexus Core services for every knowledge query.

---

## App Family

| App | Role |
|---|---|
| `digitz_ai_nexus` | AI core: knowledge, access governance, retrieval, answer engine |
| `digitz_ai_nexus_live` | Live conversation runtime: chat sessions, escalation, human handover |
| `digitz_ai_nexus_experience` | Testing and validation: test cases, synthetic data, platform validation |

**Mental model:**

```
digitz_ai_nexus        = governed AI brain
digitz_ai_nexus_live   = live conversation runtime
digitz_ai_nexus_experience = validation and testing layer
```

This app owns conversation state, agent lifecycle, and escalation. It must not duplicate retrieval logic, access resolution, or prompt building from `digitz_ai_nexus`.

---

## What `digitz_ai_nexus_live` Owns

- Agent registry (AI and human agents, roles, availability, session tracking)
- Behavior profile definitions (tone, style, memory mode, escalation rules)
- Channel definitions, chat categories, identity routes, and routing rules
- Conversation documents and message history
- Escalation rules, agent queues, and queue assignments
- Experience bundles (Q&A config, chat config, branding, welcome flows)
- Analytics: interaction logs, conversation outcomes, lead capture, performance snapshots

---

## Module Layout

```
digitz_ai_nexus_live/
├── api/
│   ├── live.py                           Public REST endpoints (ask, start_chat, send_message)
│   ├── live_studio.py                    Admin dashboard APIs (snapshot, workforce)
│   ├── live_console.py                   Live operations console (placeholder)
│   ├── nexus_profile_access_allocation.py  Profile → category assignment API
│   ├── nexus_chat_category_manager.py    Chat category CRUD API
│   └── nexus_user_profile_manager.py     User profile assignment API
├── services/
│   ├── live_chat_service.py    Chat orchestration (start, continue, context enrichment)
│   ├── live_qa_service.py      Q&A service (stateless single-exchange queries)
│   ├── agent_service.py        Agent lifecycle and profile resolution
│   ├── agent_router.py         Agent assignment (role inference, availability routing)
│   ├── escalation_service.py   Escalation decisions and handover
│   ├── conversation_service.py Conversation and message persistence + profile snapshot
│   └── conversation_context_service.py  Chat history and continuity payload building
├── digitz_ai_nexus_live/page/
│   ├── nexus_profile_access_allocation/  Profile → Access Category single-window page
│   ├── nexus_chat_category_manager/      Per-channel chat category configuration page
│   ├── nexus_user_profile_manager/       Internal user profile assignment page
│   ├── nexus_live_studio/                Agent/channel admin studio
│   └── nexus_live_console/               Live operations console
├── nexus_live_agents/          Agent, profile, user assignment DocTypes
├── nexus_live_conversations/   Conversation and message DocTypes
├── nexus_live_channels/        Channel, chat category, routing rule, widget DocTypes
├── nexus_live_escalations/     Escalation rule, queue DocTypes
├── nexus_live_experience/      Experience bundle, config, welcome flow DocTypes
└── nexus_live_analytics/       Interaction log, outcome, lead capture DocTypes
```

---

## System Data Flow

### Q&A (Stateless)

```
POST /api/method/digitz_ai_nexus_live.api.live.ask_question
    │
    ▼
live_qa_service.ask_live_question(payload)
    │
    ▼
Enrich payload: tenant context, access, channel
(digitz_ai_nexus services/tenant_context, access_resolver)
    │
    ▼
Agent assignment: agent_router.assign_agent(payload)
─ Detect required role from query keywords
─ Match available agent by role and channel
    │
    ▼
Answer query
(digitz_ai_nexus services/answer_service.answer_query)
    │
    ▼
Return answer with sources, confidence, agent_code
```

### Chat (Stateful)

```
POST /api/method/digitz_ai_nexus_live.api.live.start_chat
    │
    ▼
live_chat_service.start_live_chat(payload)
    │
    ▼
Enrich payload
    │
    ▼
Resolve chat category + identity type
(Nexus Category Identity Route → Nexus AI Agent Profile)
    │
    ▼
Agent assignment
    │
    ▼
Create Nexus Live Conversation
(conversation_service.create_conversation, including profile snapshot)
    │
    ▼
Build core payload
─ ai_profile.name must be present before access resolution
─ allowed_access_policies resolved from profile access categories
    │
    ▼
Answer query (Nexus Core)
    │
    ▼
Persist messages (user + AI)
    │
    ▼
Return conversation_id + answer

────────────────────────────────────────────────
POST /api/method/digitz_ai_nexus_live.api.live.send_chat_message
    │
    ▼
live_chat_service.continue_live_chat(conversation_id, payload)
    │
    ▼
Load conversation + message history (max 20 messages)
    │
    ▼
Build context continuity payload
(conversation_context_service.build_chat_continuity_payload)
    │
    ▼
Answer query (Nexus Core, with conversation context)
    │
    ▼
Evaluate escalation
(escalation_service.should_escalate)
─ Below confidence threshold → escalate
─ No knowledge found → escalate
─ User requested human → escalate
    │
    ├── Escalate → create escalation, mark conversation Escalated
    │
    ▼
Persist messages
    │
    ▼
Return answer + escalation_status
```

---

## Service Layer

Each service has a single responsibility. Services call each other and call into Nexus Core; they never access the database directly for cross-service data.

| Service | Responsibility |
|---|---|
| `live_chat_service` | Chat session orchestration |
| `live_qa_service` | Stateless Q&A exchange |
| `agent_service` | Agent lookup, status management, session counting |
| `agent_router` | Agent selection by role, channel, and availability |
| `escalation_service` | Escalation decision, rule lookup, queue assignment |
| `conversation_service` | Conversation and message CRUD |
| `conversation_context_service` | Chat history building for context continuity |

---

## Integration Points

This app calls into `digitz_ai_nexus` for all AI work:

| Nexus Core Service | Called By | Purpose |
|---|---|---|
| `services.answer_service.answer_query` | `live_qa_service`, `live_chat_service` | Answer a query using retrieval + LLM |
| `services.tenant_context.apply_tenant_context_to_payload` | Both services | Enrich payload with tenant defaults |
| `services.tenant_context.resolve_tenant_context` | Both services | Resolve tenant from user context |
| `engine.access_resolver.resolve_allowed_policies` | Both services | Compute allowed access policies |

This app never calls OpenAI directly. All LLM and embedding calls go through Nexus Core.

---

## Design Principles

1. **Stateful conversations, stateless queries** — Q&A exchanges are fire-and-forget; chat conversations maintain a document with full message history.
2. **Profile-first resolution** — every conversation resolves to exactly one `Nexus AI Agent Profile` before any query proceeds. The profile is the single authority for both behaviour and access.
3. **Behavior over hard-coding** — tone, response style, fallback messages, and do-not-answer rules come from `Nexus AI Agent Profile`, not string literals or agent fields.
4. **Chat Category plus identity routes** — external users declare intent by selecting a chat category. Runtime derives identity type and resolves `Nexus Category Identity Route` to the governing profile.
5. **Fail-closed escalation** — if escalation rule lookup fails, the conversation is not silently left unescalated. The service raises an error to surface misconfiguration.
6. **No retrieval logic here** — this app passes the query to Nexus Core and receives a structured response. It never reimplements chunking, scoring, or prompt building.
