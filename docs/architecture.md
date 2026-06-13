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
- Analytics: interaction logs, conversation outcomes, lead capture, performance snapshots

---

## Module Layout

```
digitz_ai_nexus_live/
├── api/
│   ├── live.py                              Public REST endpoints (ask, start_chat, send_message)
│   ├── live_studio.py                       Admin dashboard APIs (snapshot, workforce)
│   ├── identity_verification.py             OTP challenge issue and verify (allow_guest=True)
│   ├── nexus_profile_access_allocation.py   Profile → Access Category assignment + Identity Knowledge Rules
│   ├── nexus_category_profile_router.py     Category → Identity Route → Profile resolution API
│   ├── nexus_chat_category_manager.py       Chat category CRUD API
│   └── nexus_user_profile_manager.py        User profile assignment API
├── services/
│   ├── live_chat_service.py             Chat orchestration (start, continue, identity enrichment)
│   ├── live_qa_service.py               Q&A service (stateless single-exchange queries)
│   ├── identity_resolver.py             Identity type resolution (6-step priority chain)
│   ├── identity_verification.py         OTP challenge lifecycle (issue, verify, expire)
│   ├── agent_service.py                 Agent lifecycle and profile resolution
│   ├── agent_router.py                  Agent assignment (role inference, availability routing)
│   ├── escalation_service.py            Escalation decisions and handover
│   ├── conversation_service.py          Conversation and message persistence + profile snapshot
│   └── conversation_context_service.py  Chat history and continuity payload building
├── digitz_ai_nexus_live/page/
│   ├── nexus_profile_access_allocation/   Knowledge Access Manager — Profile → Category assignment
│   ├── nexus_category_profile_routes/     Category Profile Routes — per-category identity routing
│   ├── nexus_chat_category_manager/       Per-channel chat category configuration
│   ├── nexus_user_profile_manager/        Internal user profile assignment
│   ├── nexus_live_studio/                 Agent/channel admin studio
│   └── nexus_live_console/                Live operations console
├── nexus_live_agents/          Agent, profile, user assignment DocTypes
├── nexus_live_conversations/   Conversation and message DocTypes
├── nexus_live_channels/        Channel, chat category, identity route, widget DocTypes
├── nexus_live_escalations/     Escalation rule, queue DocTypes
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
─ ai_profile.knowledge_profile_names resolved from Identity Profile chain
─ allowed_access_policies = union of Knowledge Profile policies ∩ Identity Type safeguard
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
| `services.tenant_context.apply_tenant_context_to_payload` | Both services | Enrich payload with tenant defaults; Chat and Q&A use their purpose-specific channel defaults from tenant configuration |
| `services.tenant_context.resolve_tenant_context` | Both services | Resolve tenant, user context, and tenant configuration defaults |
| `engine.access_resolver.resolve_allowed_policies` | Both services | Compute allowed access policies |

This app never calls OpenAI directly. All LLM and embedding calls go through Nexus Core.

---

## Identity Resolution

Every chat message carries an identity type. `identity_resolver.resolve_identity_type(payload)` evaluates the payload in strict priority order:

| Step | Source | Condition |
|---|---|---|
| 1 | `identity_type` + `trust_payload_identity` in payload | Server-side integrations only |
| 2 | Verified OTP challenge (`identity_verification_challenge`) | Challenge token present and status = Verified |
| 3 | Nexus Identity Registry lookup | Visitor matched by OTP, Frappe session, or server-asserted `trust_visitor_email` |
| 4 | Frappe session user type | Authenticated Frappe portal or desk user, no registry entry |
| 5 | `api_scope` field | Partner / Prospect for programmatic API calls |
| 6 | Default: **Public** | No identity could be resolved — this is always the floor |

**Public is the default floor.** A visitor with no session, no OTP, and no registry entry is always "Public". Public visitors only access chunks tagged with the Public access policy.

**Registry lookup precedes Frappe session** (Step 3 before Step 4) so that external website visitors with a registry entry are correctly identified — not all visitors run inside a Frappe portal.

**Access is frozen at conversation creation.** `ai_profile_snapshot_json` on the conversation record captures both behavior and `knowledge_profile_names` at start time. Follow-up messages always restore from this snapshot; identity is never re-resolved mid-conversation.

---

## Identity Verification Offer

When a Public visitor's question hits the retrieval fallback (no knowledge found under public access), `live_chat_service` publishes `identity_verification_offer: true` alongside the fallback response. The widget renders an inline email + OTP form.

Flow:
```
Public visitor asks question
    → retrieval finds nothing under Public access
    → live_chat_service sets identity_verification_offer = true
    → widget renders email input form
    → visitor submits email
    → api/identity_verification.request_identity_verification issues OTP
    → visitor enters OTP
    → api/identity_verification.verify_identity_verification verifies
    → widget stores challenge_token in state
    → subsequent messages include identity_verification_challenge in payload
    → identity_resolver.Step 2 upgrades identity from the verified challenge
```

The OTP API accepts `conversation_id` to resolve `channel` and `chat_category` from the active conversation. This avoids the client having to track category doc names.

---

## Access Category Allocation Rules

`Nexus Access Category` records group access policies for assignment to Knowledge Profiles. **Categories whose entire policy set is "Public" are excluded from the Knowledge Access Manager allocation grid** — public knowledge is served autonomously and does not need to be assigned to a Knowledge Profile.

The filter is applied in `nexus_profile_access_allocation.get_page_data` via `_exclude_public_only_categories()`. The `cat_count` badge on each Knowledge Profile also excludes Public-only category assignments.

---

## Design Principles

1. **Stateful conversations, stateless queries** — Q&A exchanges are fire-and-forget; chat conversations maintain a document with full message history.
2. **Behavior and knowledge access are separate concerns** — `Nexus AI Agent Profile` owns behavior (tone, fallback, escalation, thresholds). Knowledge access is owned by `Nexus Identity Profile` via the person's `Nexus Identity Registry`. These two concerns must never be conflated.
3. **Identity-driven knowledge access** — knowledge access follows the person, not the AI agent. The same person gets the same knowledge access regardless of which AI agent they are talking to. Changing the AI agent does not change what knowledge the person can retrieve.
4. **Public is the default identity floor** — every visitor who cannot be identified resolves to "Public". This is intentional: the system never fails closed on identity; it fails open to the minimal access tier.
5. **Registry is authoritative for all website types** — the Nexus Identity Registry works for any website (Frappe or external) because it is looked up by OTP challenge, Frappe session, or server-asserted email — not by Frappe user type alone.
6. **Chat Category plus identity routes** — external users declare intent by selecting a chat category. Runtime resolves `Nexus Category Identity Route` to an AI behavior profile and the set of permitted Identity Profiles. For public visitors, a public route bypasses all identity profile matching.
7. **Access frozen at conversation creation** — `ai_profile_snapshot_json` freezes both behavior and `knowledge_profile_names` at conversation start. Follow-up messages restore from the snapshot — no re-resolution. Configuration changes mid-session do not affect in-progress conversations.
8. **Safeguard at identity class level** — access caps are on `Nexus Identity Type`, not on individual registry entries. All holders of an identity class are uniformly capped.
9. **Fail-closed escalation** — if escalation rule lookup fails, the conversation is not silently left unescalated. The service raises an error to surface misconfiguration.
10. **No retrieval logic here** — this app passes the query to Nexus Core and receives a structured response. It never reimplements chunking, scoring, or prompt building.
