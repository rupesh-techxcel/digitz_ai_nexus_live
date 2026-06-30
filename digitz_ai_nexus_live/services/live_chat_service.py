import json

import frappe

from digitz_ai_nexus_live.services.agent_router import assign_agent
from digitz_ai_nexus_live.services.agent_service import (
    decrement_active_sessions,
    get_agent_behavior,
    set_agent_status,
)
from digitz_ai_nexus_live.services.profile_resolver import (
    get_authenticated_session_user,
    get_session_user_type,
    get_user_context,
    is_internal_session_user,
    is_system_manager_session_user,
    resolve_behavior_from_chat_category,
    resolve_behavior_from_conversation,
    resolve_chat_category_name,
    resolve_behavior_for_internal_user,
)
from digitz_ai_nexus_live.services.conversation_service import (
    create_conversation,
    get_conversation,
    get_agent_nickname,
    update_conversation_assignment,
    add_message,
    get_conversation_messages,
)
from digitz_ai_nexus_live.services.escalation_service import (
    create_escalation,
)
from digitz_ai_nexus_live.services.intent_handler_service import (
    resolve_intents_for_profile,
)
from digitz_ai_nexus_live.services.conversation_context_service import (
    build_chat_continuity_payload,
)
from digitz_ai_nexus_live.services.chat_realtime import (
    publish_chat_response,
    publish_chat_typing,
    publish_chat_error,
)

from digitz_ai_nexus.services.answer_service import answer_query
from digitz_ai_nexus.services.tenant_context import apply_tenant_context_to_payload
from digitz_ai_nexus.engine.access_resolver import resolve_allowed_policies


MAX_HISTORY_MESSAGES = 20
CHAT_RESPONSE_SENTENCE_LIMIT = 20
DEFAULT_FALLBACK_ANSWER = "I do not have enough approved knowledge to answer this."
PUBLIC_IDENTITY_FALLBACK = (
    "I wasn't able to find an answer for your question in the publicly available knowledge. "
    "Some topics may be covered under verified access. "
    "If you'd like, share your email and I'll send you a quick verification code — "
    "that way I can check if there's more relevant information available for you."
)

# ── Closing signal detection ───────────────────────────────────────────────────

_CLOSING_PHRASES = frozenset({
    "bye", "goodbye", "good bye", "cya", "see you",
    "that's all", "thats all", "nothing else", "nothing more",
    "i'm done", "im done", "i'm all set", "im all set",
    "no more", "no more questions", "that's it", "thats it",
    "thank you", "thanks", "many thanks", "thank u", "ty",
    "that will be all", "that'll be all",
    "i'm good", "im good", "all good", "we're done", "were done",
    "all done", "that's enough", "thats enough",
})

_NO_MORE_HELP_PHRASES = frozenset({
    "no", "nope", "nah", "nothing", "nothing else", "nothing more",
    "that's all", "thats all", "i'm good", "im good",
    "i'm done", "im done", "i'm all set", "im all set",
    "bye", "goodbye", "good bye", "no thanks", "no thank you",
    "that's it", "thats it", "all good", "not really",
    "not at the moment", "all done", "we're done", "were done",
})


def _is_closing_message(message):
    """Returns True when the visitor's message clearly signals they are done."""
    text = message.strip().lower().rstrip(".,!?").strip()
    if len(text) > 80:
        return False
    return text in _CLOSING_PHRASES


def _is_no_more_help(message):
    """Returns True when the visitor confirms they need no further assistance."""
    text = message.strip().lower().rstrip(".,!?").strip()
    return text in _NO_MORE_HELP_PHRASES


def _extract_name_from_input(raw_input):
    """
    Use LLM to extract the visitor's name (and optional salutation) from free-form text.

    Examples:
        "Rupesh here"           → "Rupesh"
        "I am Rupesh"           → "Rupesh"
        "I am Mr. John Smith"   → "Mr. John Smith"
        "Dr. Sarah Connor"      → "Dr. Sarah Connor"

    Falls back to the trimmed raw input if the LLM call fails or returns nothing.
    """
    raw = (raw_input or "").strip()
    if not raw:
        return raw

    prompt = (
        'Extract the person\'s name from the message below. '
        'Also detect their title if explicitly stated (Mr., Mrs., Ms., Miss, Dr., Prof.).\n\n'
        f'Message: "{raw}"\n\n'
        'Respond with ONLY a JSON object — no markdown, no code fences, no explanation:\n'
        '{"name": "extracted name", "salutation": "Mr." or null}\n\n'
        'Rules:\n'
        '- Remove filler phrases such as "I am", "my name is", "it\'s", "this is", "here", etc.\n'
        '- Put only the bare name in "name" (no title).\n'
        '- Set "salutation" only when a title is explicitly present in the message; otherwise null.\n'
        '- If you cannot determine a name, return the original text as the name.'
    )

    try:
        from digitz_ai_nexus.engine.llm import generate_answer
        raw_response = (generate_answer(prompt) or "").strip()
        # Strip markdown code fences the LLM may wrap the JSON in
        if raw_response.startswith("```"):
            raw_response = raw_response.strip("`").lstrip("json").strip()
        result = json.loads(raw_response)
        name = (result.get("name") or "").strip()
        salutation = (result.get("salutation") or "").strip() or None
        if name:
            return f"{salutation} {name}" if salutation else name
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Live: Name extraction LLM failed")

    return raw[:100]


# ── Category picker ────────────────────────────────────────────────────────────

def _send_category_picker(conversation, greeting_name=None, publish=True, is_internal=False):
    """Send an inline category picker message to the visitor via realtime.

    Returns the response data dict so callers can include it in the HTTP
    response body (bypassing realtime race conditions for initial messages).
    Pass publish=False when the data will be delivered via the HTTP response
    body instead of (or in addition to) realtime.
    """
    visibility_filter = ["Internal", "Both"] if is_internal else ["External", "Both"]
    cat_filters = {
        "enabled": 1,
        "published": 1,
        "visibility": ["in", visibility_filter],
    }
    if is_internal and conversation.channel:
        cat_filters["channel"] = conversation.channel
    elif not is_internal:
        website_channels = _get_website_chat_channels_for_conversation(conversation)
        if website_channels:
            cat_filters["channel"] = ["in", website_channels]
        elif conversation.channel:
            cat_filters["channel"] = conversation.channel
        else:
            return None

        if getattr(conversation, "tenant", None):
            cat_filters["tenant"] = conversation.tenant

    categories = frappe.get_all(
        "Nexus Chat Category",
        filters=cat_filters,
        fields=["name", "channel", "category_code", "category_label", "description", "display_order", "use_for_nexy"],
        order_by="display_order asc",
    )

    categories = _filter_categories_with_active_routes(categories)

    if not categories:
        return None

    for category in categories:
        category["faq_questions"] = _get_faq_questions(category.name)

    if greeting_name:
        prompt = (
            f"Nice to meet you, {greeting_name}! "
            "To help direct your query, please select a topic from the options below."
        )
    else:
        prompt = (
            "To help direct your query, please select a topic from the options below."
        )

    add_message(
        conversation=conversation,
        sender_type="AI Agent",
        message=prompt,
        response_mode="chat",
    )

    frappe.db.set_value(
        "Nexus Live Conversation", conversation.name, "intent", "await_category"
    )

    data = {
        "status": "await_category",
        "response_type": "category_picker",
        "message": prompt,
        "answer": prompt,
        "categories": [dict(c) for c in categories],
        "confidence": 1.0,
        "access_status": "conversational",
        "sources": [],
    }
    if publish:
        publish_chat_response(conversation.conversation_id, data)
    return data


# ── Graceful close ─────────────────────────────────────────────────────────────

def _close_conversation_gracefully(conversation, farewell=None):
    """Save farewell message, mark conversation Closed, and push realtime event."""
    from frappe.utils import now_datetime

    if not farewell:
        visitor_name = getattr(conversation, "visitor_name", None) or None
        name_part = f", {visitor_name}" if visitor_name else ""
        farewell = (
            f"Thank you for reaching out{name_part}. "
            "It was a pleasure assisting you. "
            "Feel free to come back whenever you need help. "
            "Have a wonderful day!"
        )

    add_message(
        conversation=conversation,
        sender_type="AI Agent",
        message=farewell,
        response_mode="chat",
    )

    frappe.db.set_value("Nexus Live Conversation", conversation.name, {
        "status": "Closed",
        "closed_on": now_datetime(),
        "intent": "",
    })

    # Release agent session slot
    if conversation.assigned_agent:
        try:
            decrement_active_sessions(conversation.assigned_agent, conversation=conversation.name)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Nexus Live: Failed to decrement agent sessions on close")

    publish_chat_response(conversation.conversation_id, {
        "status": "closed",
        "response_type": "conversation_closed",
        "message": farewell,
        "answer": farewell,
        "confidence": 1.0,
        "access_status": "closed",
        "sources": [],
    })


# ── Session helpers ────────────────────────────────────────────────────────────

def apply_session_user_context(payload):
    payload = payload or {}
    user = get_authenticated_session_user()

    if not user:
        payload.setdefault("user_type", "Guest")
        return payload

    payload["user_type"] = get_session_user_type(user)
    payload["user"] = get_user_context(user)
    return payload


def build_chat_history(conversation):
    history = []

    messages = get_conversation_messages(
        conversation=conversation,
        limit=MAX_HISTORY_MESSAGES,
    )

    for row in messages:
        history.append({
            "sender_type": row.sender_type,
            "message": row.message,
        })

    return history


def enrich_payload_from_conversation(payload, conversation):
    """
    Preserve conversation-level context during follow-up chat messages.

    Priority:
    1. Explicit payload values
    2. Existing conversation values, if those fields exist
    3. User Context / Ecosystem defaults through apply_tenant_context_to_payload()
    """
    payload = payload or {}

    conversation_field_map = {
        "tenant": "tenant",
        "business_unit": "business_unit",
        "project": "project",
        "channel": "channel",
        "chat_category": "chat_category",
        "identity_type": "resolved_identity_type",
        "identity_registry": "identity_registry",
        "context": "context",
        "sub_context": "sub_context",
        "entity_type": "entity_type",
        "entity": "entity",
        "topic": "topic",
    }

    for payload_field, conversation_field in conversation_field_map.items():
        if payload.get(payload_field):
            continue

        if hasattr(conversation, conversation_field):
            value = getattr(conversation, conversation_field, None)

            if value:
                payload[payload_field] = value

    if not payload.get("identity_safeguard_access_categories"):
        raw_safeguard = getattr(conversation, "identity_safeguard_access_json", None)
        if raw_safeguard:
            payload["identity_safeguard_access_categories"] = json.loads(raw_safeguard)

    return apply_tenant_context_to_payload(
        payload=payload,
        require_tenant=False,
    )


def _build_ai_profile_dict(behavior):
    if not behavior:
        return {}

    drive_mode = getattr(behavior, "category_drive_mode", None) or "None"
    drive_prompt = getattr(behavior, "category_drive_prompt", None) or ""

    # "Companion Connect" drive activates the full companion framework even if
    # the AI Agent Profile doesn't have companion_mode set directly.
    profile_companion_mode = int(getattr(behavior, "companion_mode", 0) or 0)
    effective_companion_mode = 1 if (profile_companion_mode or drive_mode == "Companion Connect") else 0

    return {
        "name": behavior.profile_name or "",
        "knowledge_profile_names": list(behavior.knowledge_profile_names or []),
        "behavior_prompt": behavior.behavior_prompt,
        "tone": behavior.tone,
        "response_style": behavior.response_style,
        "welcome_message": behavior.welcome_message,
        "fallback_message": behavior.fallback_message,
        "do_not_answer_rules": behavior.do_not_answer_rules,
        "confidence_threshold": behavior.confidence_threshold,
        "escalation_enabled": behavior.escalation_enabled,
        "escalation_policy": behavior.escalation_policy,
        "memory_mode": behavior.memory_mode,
        "default_response_mode": "chat",
        "category_code": behavior.category_code,
        "identity_type": behavior.identity_type,
        "companion_mode": effective_companion_mode,
        "companion_playbook": getattr(behavior, "companion_playbook", None),
        "companion_discovery_style": getattr(behavior, "companion_discovery_style", None),
        "companion_controller_type": getattr(behavior, "companion_controller_type", None) or "business_companion",
        "category_drive_mode": drive_mode,
        "category_drive_prompt": drive_prompt,
    }


def build_core_chat_payload(payload, conversation, agent, behavior):
    payload = payload or {}

    continuity = build_chat_continuity_payload(
        payload={
            "query": payload.get("message"),
            "message": payload.get("message"),
            **payload,
        },
        conversation=conversation,
    )

    chat_history = build_chat_history(conversation)

    ai_profile = _build_ai_profile_dict(behavior)

    if payload.get("_post_escalation"):
        post_esc_note = (
            "\n\nCONTEXT FOR THIS RESPONSE: The visitor has just been handed back to you "
            "after a human support agent resolved their escalation. Naturally acknowledge "
            "the transition (e.g. 'I've picked up where the support agent left off…') "
            "and then address their current question or request."
        )
        ai_profile = dict(ai_profile)
        ai_profile["behavior_prompt"] = (ai_profile.get("behavior_prompt") or "") + post_esc_note

    if payload.get("_onboarding_business_response"):
        onboarding_note = (
            "\n\nCONTEXT FOR THIS RESPONSE: The visitor has just told you about their "
            "business for the first time. Acknowledge what they shared — warmly and "
            "specifically. Then naturally close your response with: 'Are you interested "
            "to learn more about how Nexy can help you grow your business?' and let the "
            "conversation flow from their answer."
        )
        ai_profile = dict(ai_profile)
        ai_profile["behavior_prompt"] = (ai_profile.get("behavior_prompt") or "") + onboarding_note

    resolved_intents = resolve_intents_for_profile(ai_profile.get("name") if ai_profile else None)

    resolved_identity_type = (
        ai_profile.get("identity_type")
        or payload.get("identity_type")
    )
    # Public identity or unauthenticated guest → restrict to "Public" policies only.
    # Applies regardless of whether an AI profile is assigned — a named profile does
    # not grant elevated knowledge access to public visitors.
    force_public_only = bool(
        payload.get("force_public_only")  # explicit "Public Access Mode" flag from desk admin
        or resolved_identity_type == "Public"
        or payload.get("user_type", "Guest") == "Guest"
        or (not ai_profile.get("name") and not ai_profile.get("knowledge_profile_names"))
    )

    user_context = payload.get("user") or {
        "roles": payload.get("roles") or ["Guest"]
    }

    access_resolution = resolve_allowed_policies({
        "channel": payload.get("channel"),
        "user": user_context,
        "force_public_only": force_public_only,
        "identity_type": resolved_identity_type,
        "identity_safeguard_access_categories": payload.get("identity_safeguard_access_categories"),
        "ai_profile": ai_profile,
    })

    return {
        "query": continuity.get("effective_query") or payload.get("message"),
        "original_query": continuity.get("original_query") or payload.get("message"),
        "response_mode": "chat",
        "response_sentence_limit": CHAT_RESPONSE_SENTENCE_LIMIT,

        "tenant": payload.get("tenant"),
        "business_unit": payload.get("business_unit"),
        "project": payload.get("project"),
        "project_scope_mode": payload.get("project_scope_mode") or "with_general",
        "caller_system": "Nexus Live",
        "use_case": "Live Chat",

        "context": payload.get("context"),
        "sub_context": payload.get("sub_context"),
        "entity_type": payload.get("entity_type"),
        "entity": payload.get("entity"),
        "topic": payload.get("topic"),

        "top_k": payload.get("top_k"),
        "channel": payload.get("channel"),

        "conversation_id": conversation.conversation_id,
        "chat_history": chat_history,
        "conversation_context": continuity.get("conversation_context"),
        "context_message_count": continuity.get("context_message_count"),
        "is_follow_up": continuity.get("is_follow_up"),

        "user": user_context,
        "force_public_only": force_public_only,
        "allowed_access_policies": access_resolution["allowed_access_policies"],
        "_access_cap_applied": access_resolution.get("access_cap_applied"),

        "ai_profile": ai_profile,
        "resolved_intents": resolved_intents,

        "agent_code": agent.agent_code,
        "agent_role": agent.agent_role,

        "_resolved_tenant_context": payload.get("_resolved_tenant_context"),
    }


def _resolve_behavior(payload, conversation=None, agent=None):
    """
    Resolve AI behavior in priority order:
    1. Stored profile on the conversation (follow-up messages / consistent across turns)
    2. Internal desk user's active Nexus User Profile Assignment
    3. chat_category in payload (visitor selection at conversation start)
    4. Agent behavior (legacy / non-chat-category path)
    """
    if conversation:
        from_conversation = resolve_behavior_from_conversation(conversation)
        if from_conversation:
            return from_conversation

    session_user = get_authenticated_session_user()
    if is_internal_session_user(session_user):
        internal_behavior = resolve_behavior_for_internal_user(session_user)
        if not internal_behavior and not is_system_manager_session_user(session_user):
            frappe.throw(
                "No active Nexus User Profile Assignment exists for the logged-in user. "
                "Please ask an administrator to assign an AI Agent Profile."
            )
        return internal_behavior

    chat_category = payload.get("chat_category")
    if chat_category:
        from digitz_ai_nexus_live.services.identity_resolver import resolve_identity_type
        is_authenticated = (
            (payload.get("user_type", "Guest") != "Guest" and bool(payload.get("user")))
            or frappe.session.user not in ("Guest", None, "")
        )
        identity_type = resolve_identity_type(payload)
        return resolve_behavior_from_chat_category(
            chat_category, identity_type, is_authenticated, payload=payload
        )

    if agent:
        return get_agent_behavior(agent)

    return None


# ── start_live_chat ────────────────────────────────────────────────────────────

def start_live_chat(payload):
    payload = payload or {}
    payload["conversation_type"] = "Chat"
    payload = apply_session_user_context(payload)

    session_user = get_authenticated_session_user()
    is_internal = is_internal_session_user(session_user)

    # Widget sends roles=['Guest'] when operating in website-visitor mode.
    # Honour that even when the HTTP session belongs to a desk user
    # (e.g. a developer testing the widget while logged in to the desk).
    if is_internal and "Guest" in (payload.get("roles") or []):
        payload["user_type"] = "Guest"
        payload.pop("user", None)
        is_internal = False

    message = (payload.get("message") or "").strip()

    # ── Desk / internal user path ──────────────────────────────────────────────
    if is_internal:
        if payload.get("chat_category"):
            from digitz_ai_nexus_live.services.identity_verification import (
                enforce_category_verification,
            )
            challenge = enforce_category_verification(payload)
            if challenge and challenge.identity_registry:
                payload["identity_registry"] = challenge.identity_registry

        payload = apply_tenant_context_to_payload(payload=payload, require_tenant=False)

        internal_behavior = resolve_behavior_for_internal_user(session_user)
        if not internal_behavior and not is_system_manager_session_user(session_user):
            frappe.throw(
                "No active Nexus User Profile Assignment exists for the logged-in user. "
                "Please ask an administrator to assign an AI Agent Profile."
            )

        ai_profile_override = None
        if internal_behavior:
            if internal_behavior.profile_name:
                ai_profile_override = frappe.get_doc(
                    "Nexus AI Agent Profile", internal_behavior.profile_name
                )
            payload["knowledge_profile_names"] = internal_behavior.knowledge_profile_names or []
            payload["identity_type"] = internal_behavior.identity_type

        if ai_profile_override and ai_profile_override.get("agent_name"):
            payload["agent"] = ai_profile_override.agent_name

        # Desk users always use internal-visibility agents.
        # Explicit routing priority (handled in assign_agent / find_available_agent):
        #   1. payload["agent"] set above from Nexus User Profile Assignment
        #   2. Channel's default_agent (configure on Nexus Live Channel)
        #   3. Role/intent detection fallback
        if not payload.get("agent"):
            # Switch to the Desk-type channel for this tenant so the role-based
            # fallback finds the Internal Assistant (whose default_channel is the
            # Desk channel, not the website channel resolved by tenant context).
            tenant = payload.get("tenant")
            if tenant:
                desk_channel = frappe.db.get_value(
                    "Nexus Live Channel",
                    {"tenant": tenant, "channel_type": "Desk", "enabled": 1},
                    "name",
                )
                if desk_channel:
                    payload["channel"] = desk_channel
            # Signal the role explicitly so detect_required_role doesn't default
            # to "Public Responder" (which is only valid for unauthenticated visitors).
            payload.setdefault("agent_role", "Internal Assistant")
            payload.setdefault("visibility", "Internal")

        agent = assign_agent(payload)
        if not agent:
            frappe.throw(
                "No AI agent is available for desk chat. "
                "Set a Default Agent on the Nexus Live Channel, or assign a "
                "Nexus User Profile Assignment for this user."
            )

        conversation = create_conversation(
            payload=payload,
            assigned_agent=agent,
            ai_profile_override=ai_profile_override,
        )
        conversation = update_conversation_assignment(conversation, agent)

        # Resolve internal user's first name and freeze it on the conversation
        first_name = frappe.db.get_value("User", session_user, "first_name") or ""
        if first_name and not conversation.visitor_name:
            frappe.db.set_value(
                "Nexus Live Conversation", conversation.name,
                "visitor_name", first_name, update_modified=False,
            )
            conversation.visitor_name = first_name

        agent_nick = get_agent_nickname(conversation, agent)

        if message:
            add_message(
                conversation=conversation,
                sender_type="User",
                message=message,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            _enqueue_ai_response(conversation.conversation_id, payload)
            return {
                "status": "processing",
                "conversation": conversation.name,
                "conversation_id": conversation.conversation_id,
                "agent": agent.name,
                "agent_code": agent.agent_code,
                "agent_name": agent_nick,
                "agent_instance": getattr(conversation, "agent_profile_instance", None),
                "initial_messages": [],
            }

        # Widget opened with no initial message.
        # In Public Access Mode the desk user simulates a public visitor, so we
        # use External/Both visibility categories from website channels (which
        # includes the Nexy option). Otherwise use Internal/Both on the desk channel.
        force_public_only = bool(payload.get("force_public_only"))
        picker_is_internal = not force_public_only

        if force_public_only:
            has_picker_categories = frappe.db.exists(
                "Nexus Chat Category",
                {
                    "enabled": 1,
                    "published": 1,
                    "visibility": ["in", ["External", "Both"]],
                },
            )
        else:
            has_picker_categories = frappe.db.exists(
                "Nexus Chat Category",
                {
                    "channel": conversation.channel,
                    "enabled": 1,
                    "published": 1,
                    "visibility": ["in", ["Internal", "Both"]],
                },
            )

        name_part = f", {first_name}" if first_name else ""

        if has_picker_categories:
            intro = (
                f"Hi{name_part}! I'm {agent_nick}, your AI assistant. "
                "Please select a topic so I can assist you better."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=intro,
                response_mode="chat",
            )
            intro_data = {
                "status": "success",
                "response_type": "message",
                "message": intro,
                "answer": intro,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "conversation_id": conversation.conversation_id,
            }
            category_data = _send_category_picker(conversation, publish=False, is_internal=picker_is_internal)
            if category_data is not None:
                category_data["agent_name"] = agent_nick
                return {
                    "status": "await_category",
                    "conversation": conversation.name,
                    "conversation_id": conversation.conversation_id,
                    "agent": agent.name,
                    "agent_code": agent.agent_code,
                    "agent_name": agent_nick,
                    "agent_instance": getattr(conversation, "agent_profile_instance", None),
                    "initial_messages": [intro_data, category_data],
                }

        greeting = (
            f"Hi{name_part}! I'm {agent_nick}, your AI assistant. How can I help you today?"
        )
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=greeting,
            response_mode="chat",
        )

        return {
            "status": "ready",
            "conversation": conversation.name,
            "conversation_id": conversation.conversation_id,
            "agent": agent.name,
            "agent_code": agent.agent_code,
            "agent_name": agent_nick,
            "agent_instance": getattr(conversation, "agent_profile_instance", None),
            "initial_messages": [{
                "status": "success",
                "response_type": "message",
                "message": greeting,
                "answer": greeting,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "conversation_id": conversation.conversation_id,
            }],
        }

    # ── Visitor / guest path ───────────────────────────────────────────────────
    if payload.get("chat_category") and not is_internal:
        from digitz_ai_nexus_live.services.identity_verification import (
            enforce_category_verification,
        )
        challenge = enforce_category_verification(payload)
        if challenge and challenge.identity_registry:
            payload["identity_registry"] = challenge.identity_registry

    payload = apply_tenant_context_to_payload(payload=payload, require_tenant=False)

    ai_profile_override = None
    chat_category = payload.get("chat_category")
    if chat_category:
        category_name = resolve_chat_category_name(chat_category)
        if category_name:
            category_channel = frappe.db.get_value(
                "Nexus Chat Category",
                category_name,
                "channel",
            )
            payload["chat_category"] = category_name
            payload["channel"] = category_channel or payload.get("channel")
            chat_category = category_name

        from digitz_ai_nexus_live.services.identity_resolver import (
            resolve_identity_registry_name,
            resolve_identity_safeguard_access_categories,
            resolve_identity_type,
        )
        is_authenticated = (
            (payload.get("user_type", "Guest") != "Guest" and bool(payload.get("user")))
            or frappe.session.user not in ("Guest", None, "")
        )
        identity_type = resolve_identity_type(payload)
        cat_behavior = resolve_behavior_from_chat_category(
            chat_category, identity_type, is_authenticated, payload=payload
        )
        if cat_behavior and cat_behavior.profile_name:
            payload["identity_type"] = identity_type
            payload["identity_registry"] = payload.get("identity_registry") or resolve_identity_registry_name(payload)
            safeguard_categories = resolve_identity_safeguard_access_categories(payload)
            if safeguard_categories is not None:
                payload["identity_safeguard_access_categories"] = safeguard_categories
            payload["knowledge_profile_names"] = cat_behavior.knowledge_profile_names or []
            ai_profile_override = frappe.get_doc(
                "Nexus AI Agent Profile", cat_behavior.profile_name
            )
        else:
            frappe.throw(
                "No active AI Agent Profile route exists for this chat category "
                f"and identity type ({identity_type})."
            )

    if ai_profile_override and ai_profile_override.get("agent_name"):
        payload["agent"] = ai_profile_override.agent_name

    agent = assign_agent(payload)
    if not agent:
        frappe.throw("No approved idle AI agent available for live chat.")

    conversation = create_conversation(
        payload=payload,
        assigned_agent=agent,
        ai_profile_override=ai_profile_override,
    )
    conversation = update_conversation_assignment(conversation, agent)

    # Store visitor's opening message if provided
    if message:
        add_message(
            conversation=conversation,
            sender_type="Visitor",
            message=message,
            response_mode="chat",
        )
        _touch_last_message_at(conversation)

    # Collect initial messages to return in the HTTP response body.
    # Realtime publish during an HTTP handler is racy: the socket may not have
    # joined the task room before the event is emitted. Returning them in the
    # HTTP response guarantees delivery. The live console still learns of the
    # conversation through subsequent realtime events (category selection, AI
    # response, etc.), so we skip realtime here to avoid duplicate display.
    initial_messages = []

    agent_nick = get_agent_nickname(conversation, agent)

    # Send greeting with agent's persona name
    greeting = f"Hi! I'm {agent_nick}, your AI assistant. It's great to have you here!"
    add_message(
        conversation=conversation,
        sender_type="AI Agent",
        message=greeting,
        response_mode="chat",
    )
    greeting_data = {
        "status": "success",
        "response_type": "message",
        "message": greeting,
        "answer": greeting,
        "agent_name": agent_nick,
        "confidence": 1.0,
        "access_status": "conversational",
        "sources": [],
        "conversation_id": conversation.conversation_id,
    }
    initial_messages.append(greeting_data)

    # Always ask public visitors for their name to personalise the conversation
    needs_name = (
        not conversation.visitor_name
        and not payload.get("visitor_name")
    )

    if needs_name:
        name_prompt = "Before we get started, could I get your name please?"
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=name_prompt,
            response_mode="chat",
        )
        frappe.db.set_value(
            "Nexus Live Conversation", conversation.name, "intent", "await_name"
        )
        name_data = {
            "status": "await_name",
            "response_type": "message",
            "message": name_prompt,
            "answer": name_prompt,
            "agent_name": agent_nick,
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
            "conversation_id": conversation.conversation_id,
        }
        initial_messages.append(name_data)
    elif not chat_category:
        # No category selected yet — show category picker if any exist.
        # Deliver via HTTP response only (publish=False) to avoid duplicate
        # display if the socket also receives the event later.
        category_data = _send_category_picker(conversation, publish=False)
        if category_data:
            category_data["conversation_id"] = conversation.conversation_id
            category_data["agent_name"] = agent_nick
            initial_messages.append(category_data)
        else:
            # No external categories configured — proceed to direct chat
            ready_prompt = "How can I help you today?"
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=ready_prompt,
                response_mode="chat",
            )
            initial_messages.append({
                "status": "success",
                "response_type": "message",
                "message": ready_prompt,
                "answer": ready_prompt,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "conversation_id": conversation.conversation_id,
            })
    else:
        # Category already selected (e.g. visitor passed it in) — proceed with AI
        if message:
            _enqueue_ai_response(conversation.conversation_id, payload)
        else:
            ready_prompt = "How can I help you today?"
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=ready_prompt,
                response_mode="chat",
            )
            ready_data = {
                "status": "success",
                "response_type": "message",
                "message": ready_prompt,
                "answer": ready_prompt,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "conversation_id": conversation.conversation_id,
            }
            initial_messages.append(ready_data)

    # Determine effective status for the widget state machine
    if needs_name:
        effective_status = "awaiting_name"
    elif not chat_category:
        # Check whether the picker was actually sent (categories existed)
        picker_sent = any(m.get("response_type") == "category_picker" for m in initial_messages)
        effective_status = "await_category" if picker_sent else "ready"
    else:
        effective_status = "processing"

    return {
        "status": effective_status,
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,
        "agent": agent.name,
        "agent_code": agent.agent_code,
        "agent_name": get_agent_nickname(conversation, agent),
        "agent_instance": getattr(conversation, "agent_profile_instance", None),
        "initial_messages": initial_messages,
    }


# ── continue_live_chat ─────────────────────────────────────────────────────────

def continue_live_chat(conversation_id, payload):
    payload = payload or {}
    payload = apply_session_user_context(payload)

    conversation = get_conversation(conversation_id)
    if not conversation:
        frappe.throw("Conversation not found.")

    # Reject input on closed conversations
    if conversation.status == "Closed":
        return {
            "status": "closed",
            "message": "This conversation is closed. Please start a new conversation.",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # When escalated: store message and send holding response; do not invoke AI
    if conversation.status == "Escalated":
        message = (payload.get("message") or "").strip()
        if message:
            sender_type = "Visitor" if payload.get("user_type", "Guest") == "Guest" else "User"
            add_message(
                conversation=conversation,
                sender_type=sender_type,
                message=message,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            # Push visitor message to agent panel via same realtime channel
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "visitor_message",
                "message": message,
                "answer": message,
                "sender_type": sender_type,
                "confidence": 1.0,
                "access_status": "escalated",
                "sources": [],
            })
            # Only show the holding acknowledgment when no agent has claimed yet.
            # Once a human agent is actively chatting, the visitor's messages flow through silently.
            if not conversation.human_agent:
                holding = (
                    "Your message has been received. "
                    "Our agent will respond to you shortly."
                )
                publish_chat_response(conversation.conversation_id, {
                    "status": "success",
                    "response_type": "message_held",
                    "message": holding,
                    "answer": holding,
                    "confidence": 1.0,
                    "access_status": "escalated",
                    "sources": [],
                })
        return {
            "status": "escalated",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    if not conversation.assigned_agent:
        frappe.throw("Conversation has no assigned agent.")

    message = (payload.get("message") or "").strip()

    # Silent post-verification advance trigger sent automatically by the widget
    # after OTP verification.  Substitute a neutral phrase for LLM/steering
    # context but suppress the visible visitor message bubble.
    _is_idv_advance = (message == "__idv_advance__")
    if _is_idv_advance:
        message = "email verified"

    if not message:
        frappe.throw("Message is required.")

    payload["message"] = message
    payload = enrich_payload_from_conversation(
        payload=payload,
        conversation=conversation,
    )

    intent = conversation.intent or ""
    sender_type = "Visitor" if payload.get("user_type", "Guest") == "Guest" else "User"

    # ── Category selection gate ────────────────────────────────────────────────
    # If waiting for a category, any non-category message is rejected and the
    # picker is re-shown. Users cannot skip the selection by typing.
    if intent == "await_category" and not message.startswith("__cat__:"):
        _is_internal_conv = (
            getattr(conversation, "user_type", "") == "Desk User"
            and not payload.get("force_public_only")
        )
        nudge = "Please select a topic from the options above before sending a message."
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=nudge,
            response_mode="chat",
        )
        _send_category_picker(conversation, is_internal=_is_internal_conv)
        return {
            "status": "await_category",
            "response_type": "message",
            "message": nudge,
            "answer": nudge,
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Category selection (transparent — don't store __cat__ as visitor message) ──
    if intent == "await_category" and message.startswith("__cat__:"):
        category_code = message.split(":", 1)[1].strip()
        category_name = resolve_chat_category_name(category_code)

        cat = frappe.db.get_value(
            "Nexus Chat Category",
            {"name": category_name, "enabled": 1, "published": 1} if category_name else {"category_code": category_code, "enabled": 1, "published": 1},
            ["name", "channel", "category_code", "category_label", "identity_verification_mode",
             "internal_drive_mode", "internal_drive_prompt"],
            as_dict=True,
        )

        if not cat:
            # Unknown code — re-show picker
            _is_internal_conv = getattr(conversation, "user_type", "") == "Desk User"
            _send_category_picker(conversation, is_internal=_is_internal_conv)
            return {
                "status": "await_category",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        verification_mode = cat.get("identity_verification_mode") or "None"
        requires_verification = (
            verification_mode != "None"
            and getattr(conversation, "user_type", "Guest") == "Guest"
        )

        new_intent = "await_verification" if requires_verification else ""
        conversation_updates = {
            "chat_category": cat.name,
            "channel": cat.channel,
            "intent": new_intent,
        }
        _is_companion_mode = False

        payload["chat_category"] = cat.name
        payload["channel"] = cat.channel

        if not requires_verification:
            from digitz_ai_nexus_live.services.identity_resolver import resolve_identity_type

            # Public Access Mode: simulate a public visitor for routing so that the
            # category route and AI profile configured for "Public" identity are used,
            # exactly as a real public visitor would experience.
            if payload.get("force_public_only"):
                identity_type = "Public"
                _is_authenticated = False
            else:
                identity_type = resolve_identity_type(payload)
                _is_authenticated = (
                    (payload.get("user_type", "Guest") != "Guest" and bool(payload.get("user")))
                    or frappe.session.user not in ("Guest", None, "")
                )
            cat_behavior = resolve_behavior_from_chat_category(
                cat.name,
                identity_type,
                _is_authenticated,
                payload=payload,
            )
            if cat_behavior and cat_behavior.profile_name:
                profile = frappe.get_doc(
                    "Nexus AI Agent Profile",
                    cat_behavior.profile_name,
                )
                payload["identity_type"] = identity_type
                payload["knowledge_profile_names"] = cat_behavior.knowledge_profile_names or []
                conversation_updates.update({
                    "resolved_identity_type": identity_type,
                    "assigned_agent": profile.name,
                    "assigned_agent_type": "AI",
                    "assigned_ai_agent_profile": profile.name,
                    "ai_profile_snapshot_json": json.dumps({
                        "name": profile.name,
                        "nickname": getattr(profile, "display_name", None) or getattr(profile, "agent_name", None),
                        "chat_category": cat.name,
                        "category_code": cat.category_code,
                        "category_label": cat.category_label,
                        "identity_type": identity_type,
                        "identity_registry": payload.get("identity_registry"),
                        "identity_safeguard_access_categories": payload.get(
                            "identity_safeguard_access_categories"
                        ),
                        "knowledge_profile_names": cat_behavior.knowledge_profile_names or [],
                        "behavior_prompt": profile.behavior_prompt,
                        "tone": profile.tone,
                        "response_style": profile.response_style,
                        "welcome_message": profile.welcome_message,
                        "fallback_message": profile.fallback_message,
                        "do_not_answer_rules": profile.do_not_answer_rules,
                        "confidence_threshold": profile.confidence_threshold,
                        "escalation_enabled": profile.escalation_enabled,
                        "escalation_policy": profile.escalation_policy,
                        "memory_mode": profile.memory_mode,
                        "default_response_mode": profile.default_response_mode,
                        "collect_visitor_name": getattr(profile, "collect_visitor_name", 0),
                        "companion_mode": int(getattr(profile, "companion_mode", 0) or 0),
                        "companion_playbook": getattr(profile, "companion_playbook", None),
                        "companion_discovery_style": getattr(profile, "companion_discovery_style", None),
                        "companion_controller_type": getattr(cat, "companion_controller_type", None) or "business_companion",
                        "calendly_link": getattr(profile, "calendly_link", None) or None,
                        "category_drive_mode": getattr(cat, "internal_drive_mode", None) or "None",
                        "category_drive_prompt": getattr(cat, "internal_drive_prompt", None) or "",
                    }),
                })
                _is_companion_mode = int(getattr(profile, "companion_mode", 0) or 0) == 1
                if _is_companion_mode:
                    conversation_updates["intent"] = "onboarding_business"

        frappe.db.set_value("Nexus Live Conversation", conversation.name, conversation_updates)
        conversation.reload()

        visitor_name = conversation.visitor_name or ""
        name_part = f", {visitor_name}" if visitor_name else ""
        agent_nick = get_agent_nickname(conversation)

        if requires_verification:
            ack = (
                f"To get started with **{cat.category_label}**, we need to verify your identity. "
                "Please enter your email address below."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=ack,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": ack,
                "answer": ack,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "identity_verification_offer": True,
                "faq_questions": [],
            })

        elif _is_companion_mode:
            # Onboarding flow: two mandatory messages before free chat opens.
            # intent has been set to "onboarding_business" in conversation_updates above.
            intro = (
                f"Hi{name_part}! I'm {agent_nick} — here to understand your business "
                "and connect you with what's most relevant."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=intro,
                response_mode="chat",
            )
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": intro,
                "answer": intro,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
            })

            biz_ask = "What does your company do, and what's the main challenge you're looking to solve?"
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=biz_ask,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": biz_ask,
                "answer": biz_ask,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
            })

        else:
            ack = (
                f"Perfect{name_part}! I'll be assisting you with {cat.category_label}. "
                "What would you like to know?"
            )
            faq_questions = _get_faq_questions(cat.name)
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=ack,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": ack,
                "answer": ack,
                "agent_name": agent_nick,
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "identity_verification_offer": False,
                "faq_questions": faq_questions,
            })

        return {
            "status": "category_selected",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── FAQ selection (direct answer — no LLM) ────────────────────────────────
    if message.startswith("__faq__:"):
        faq_row_name = message.split(":", 1)[1].strip()

        faq_row = frappe.db.get_value(
            "Nexus Chat Category FAQ",
            faq_row_name,
            ["question", "answer", "parent", "enabled"],
            as_dict=True,
        )
        if faq_row and not faq_row.get("enabled"):
            faq_row = None

        if not faq_row:
            return {
                "status": "faq_not_found",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        # Store question as visitor message, answer as agent message
        add_message(
            conversation=conversation,
            sender_type=sender_type,
            message=faq_row.question,
            response_mode="chat",
        )
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=faq_row.answer,
            response_mode="chat",
        )
        _touch_last_message_at(conversation)

        # Reload remaining FAQ chips for this category
        remaining_faq = _get_faq_questions(faq_row.parent, exclude_name=faq_row_name)

        publish_chat_response(conversation.conversation_id, {
            "status": "success",
            "response_type": "faq_answer",
            "faq_question": faq_row.question,
            "message": faq_row.answer,
            "answer": faq_row.answer,
            "agent_name": get_agent_nickname(conversation),
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
            "faq_questions": remaining_faq,
        })

        return {
            "status": "faq_answered",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Identity verification gate ─────────────────────────────────────────────
    # When the category requires OTP verification the conversation is put into
    # "await_verification" until the visitor supplies a valid challenge token.
    # Once verified the intent is cleared and message processing continues.
    if intent == "await_verification":
        from digitz_ai_nexus_live.services.identity_verification import (
            get_category_verification_mode,
            get_verified_challenge,
        )
        _vcat = payload.get("chat_category") or getattr(conversation, "chat_category", None)
        _vmode = get_category_verification_mode(_vcat) if _vcat else "None"

        _challenge = None
        if _vmode != "None":
            _challenge = get_verified_challenge(
                challenge_token=payload.get("identity_verification_challenge"),
                chat_category=_vcat,
            )

        if _vmode != "None" and not _challenge:
            _cat_label = frappe.db.get_value("Nexus Chat Category", _vcat, "category_label") or _vcat
            nudge = f"Please verify your identity before continuing with {_cat_label}."
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=nudge,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "await_verification",
                "response_type": "message",
                "message": nudge,
                "answer": nudge,
                "confidence": 1.0,
                "access_status": "awaiting_verification",
                "sources": [],
                "identity_verification_offer": True,
            })
            return {
                "status": "await_verification",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        # Persist the verified address on the conversation and record why it was collected.
        _verified_identity_type = _challenge.resolved_identity_type
        _verified_identity_registry = _challenge.identity_registry
        _verified_updates = {
            "intent": "",
            "visitor_email": _challenge.email,
            "resolved_identity_type": _verified_identity_type,
            "identity_registry": _verified_identity_registry,
        }

        # Stamp the AI profile snapshot now that identity is confirmed — the
        # category selection intentionally deferred this until verification was done.
        _vcat_name = payload.get("chat_category") or getattr(conversation, "chat_category", None)
        if _vcat_name and not getattr(conversation, "assigned_ai_agent_profile", None):
            _is_authenticated = (
                (payload.get("user_type", "Guest") != "Guest" and bool(payload.get("user")))
                or frappe.session.user not in ("Guest", None, "")
            )
            _post_verify_behavior = resolve_behavior_from_chat_category(
                _vcat_name, _verified_identity_type, _is_authenticated,
                payload={**payload, "identity_type": _verified_identity_type},
            )
            if _post_verify_behavior and _post_verify_behavior.profile_name:
                _pv_profile = frappe.get_doc("Nexus AI Agent Profile", _post_verify_behavior.profile_name)
                _pv_cat = frappe.get_doc("Nexus Chat Category", _vcat_name)
                _verified_updates.update({
                    "assigned_agent": _pv_profile.name,
                    "assigned_agent_type": "AI",
                    "assigned_ai_agent_profile": _pv_profile.name,
                    "ai_profile_snapshot_json": json.dumps({
                        "name": _pv_profile.name,
                        "nickname": getattr(_pv_profile, "display_name", None) or getattr(_pv_profile, "agent_name", None),
                        "chat_category": _vcat_name,
                        "category_code": _pv_cat.category_code,
                        "category_label": _pv_cat.category_label,
                        "identity_type": _verified_identity_type,
                        "identity_registry": _verified_identity_registry,
                        "knowledge_profile_names": _post_verify_behavior.knowledge_profile_names or [],
                        "behavior_prompt": _pv_profile.behavior_prompt,
                        "tone": _pv_profile.tone,
                        "response_style": _pv_profile.response_style,
                        "welcome_message": _pv_profile.welcome_message,
                        "fallback_message": _pv_profile.fallback_message,
                        "do_not_answer_rules": _pv_profile.do_not_answer_rules,
                        "confidence_threshold": _pv_profile.confidence_threshold,
                        "escalation_enabled": _pv_profile.escalation_enabled,
                        "escalation_policy": _pv_profile.escalation_policy,
                        "memory_mode": _pv_profile.memory_mode,
                        "default_response_mode": _pv_profile.default_response_mode,
                        "collect_visitor_name": int(getattr(_pv_profile, "collect_visitor_name", 0) or 0),
                        "companion_mode": int(getattr(_pv_profile, "companion_mode", 0) or 0),
                        "companion_playbook": getattr(_pv_profile, "companion_playbook", None),
                        "companion_discovery_style": getattr(_pv_profile, "companion_discovery_style", None),
                        "category_drive_mode": getattr(_pv_cat, "internal_drive_mode", None) or "None",
                        "category_drive_prompt": getattr(_pv_cat, "internal_drive_prompt", None) or "",
                    }),
                })

        frappe.db.set_value("Nexus Live Conversation", conversation.name, _verified_updates)
        conversation.reload()
        from digitz_ai_nexus_live.services.visitor_data_capture import capture_from_conversation
        from digitz_ai_nexus_live.services.conversation_service import stamp_email_on_web_visitor

        capture_from_conversation(
            conversation,
            collection_context="Identity Verification",
            collection_reason="Email collected to verify access to the selected chat option.",
            source_event="identity_verification_completed",
            email_verified=True,
            consent_status="Service Requested",
            consent_scope="Identity verification and access to the selected chat service",
            reference_doctype="Nexus Identity Verification Challenge",
            reference_name=_challenge.name,
        )

        # Write the verified email back to the linked Nexus Web Visitor record
        # so visitor analytics show the identified email alongside anonymous tracking data.
        stamp_email_on_web_visitor(conversation, _challenge.email, verified=True)

        intent = ""

    # ── Nexy handover verification ─────────────────────────────────────────────
    if intent == "await_nexy_verification":
        from digitz_ai_nexus_live.services.identity_verification import (
            get_verified_challenge,
        )
        from digitz_ai_nexus_live.services.nexy_handover_service import complete_nexy_handover
        from digitz_ai_nexus_live.services.conversation_service import stamp_email_on_web_visitor

        _nexy_cat = getattr(conversation, "nexy_handover_category", None)
        _challenge = get_verified_challenge(
            challenge_token=payload.get("identity_verification_challenge"),
            chat_category=_nexy_cat,
        ) if _nexy_cat else None

        if not _challenge:
            _cat_label = (
                frappe.db.get_value("Nexus Chat Category", _nexy_cat, "category_label")
                if _nexy_cat else "Nexy"
            )
            nudge = (
                f"To connect with {_cat_label}, please verify your identity. "
                "Enter your email address and we'll send you a quick verification code."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=nudge,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "await_nexy_verification",
                "response_type": "message",
                "message": nudge,
                "answer": nudge,
                "confidence": 1.0,
                "access_status": "awaiting_verification",
                "sources": [],
                "identity_verification_offer": True,
            })
            return {
                "status": "await_nexy_verification",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        # Challenge verified — stamp email and complete handover
        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "visitor_email": _challenge.email,
            "resolved_identity_type": _challenge.resolved_identity_type,
            "identity_registry": _challenge.identity_registry,
        })
        conversation.reload()

        stamp_email_on_web_visitor(conversation, _challenge.email, verified=True)

        payload["visitor_email"] = _challenge.email
        payload["identity_type"] = _challenge.resolved_identity_type

        handover_result = complete_nexy_handover(conversation, payload)
        if not handover_result:
            # Nexy profile could not be resolved — fall through to normal AI
            pass
        else:
            # Announce the handover to the visitor
            _nexy_label = (
                frappe.db.get_value(
                    "Nexus Chat Category",
                    getattr(conversation, "chat_category", None),
                    "category_label",
                ) or "Nexy"
            )
            handover_msg = (
                f"Identity verified. You're now connected to {_nexy_label}. "
                "How can I help you today?"
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=handover_msg,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "nexy_handover_complete",
                "response_type": "message",
                "message": handover_msg,
                "answer": handover_msg,
                "agent_name": get_agent_nickname(conversation),
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
            })
            return {
                "status": "nexy_handover_complete",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        intent = ""

    # ── Pre-escalation email verification ──────────────────────────────────────
    # Set when visitor requests a human agent but has not yet verified their email.
    # OTP must pass before the escalation is created and the desk is notified.
    if intent == "await_pre_escalation_verification":
        from digitz_ai_nexus_live.services.identity_verification import get_verified_challenge
        from digitz_ai_nexus_live.services.conversation_service import stamp_email_on_web_visitor

        _pesc_cat = getattr(conversation, "chat_category", None)
        _pesc_challenge = get_verified_challenge(
            challenge_token=payload.get("identity_verification_challenge"),
            chat_category=_pesc_cat,
        ) if _pesc_cat else None

        if not _pesc_challenge:
            nudge = (
                "To connect you with our team, please verify your email address. "
                "Enter your email and we'll send you a quick verification code."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=nudge,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "await_pre_escalation_verification",
                "response_type": "message",
                "message": nudge,
                "answer": nudge,
                "confidence": 1.0,
                "access_status": "awaiting_verification",
                "sources": [],
                "identity_verification_offer": True,
            })
            return {
                "status": "await_pre_escalation_verification",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        # OTP verified — stamp email, create escalation, notify desk
        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "visitor_email": _pesc_challenge.email,
            "intent": "",
        })
        conversation.reload()

        stamp_email_on_web_visitor(conversation, _pesc_challenge.email, verified=True)

        _pesc_agent = frappe.get_doc("Nexus AI Agent Profile", conversation.assigned_agent)
        _pesc_esc = create_escalation(
            conversation=conversation,
            reason="User Requested Human",
            from_agent=_pesc_agent,
            confidence=None,
            remarks="User requested escalation; email verified before desk notification.",
        )

        _pesc_calendly = getattr(_pesc_agent, "calendly_link", None) or None
        if _pesc_calendly:
            confirmed_msg = (
                "Your email has been verified. Your request has been forwarded to our team — "
                "an agent will respond based on their availability. "
                "Alternatively, you can book a meeting directly using the calendar below."
            )
        else:
            confirmed_msg = (
                "Your email has been verified. Your request has been forwarded to our team — "
                "a desk agent will review and connect with you shortly. "
                "You can continue chatting in the meantime."
            )
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=confirmed_msg,
            response_mode="chat",
        )
        _touch_last_message_at(conversation)
        publish_chat_response(conversation.conversation_id, {
            "status": "escalation_requested",
            "response_type": "message",
            "message": confirmed_msg,
            "answer": confirmed_msg,
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
            "escalation_requested": True,
            "escalation": _pesc_esc.name if _pesc_esc else None,
            "calendly_link": _pesc_calendly,
        })
        return {
            "status": "escalation_requested",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Escalation approval email verification ─────────────────────────────────
    # Set when a desk agent approves an escalation request but the visitor has
    # not yet verified their email. Cleared once OTP is confirmed.
    if intent == "await_escalation_verification":
        from digitz_ai_nexus_live.services.identity_verification import get_verified_challenge
        from digitz_ai_nexus_live.services.escalation_service import _complete_approved_escalation
        from digitz_ai_nexus_live.services.conversation_service import stamp_email_on_web_visitor

        _esc_cat = getattr(conversation, "chat_category", None)
        _esc_challenge = get_verified_challenge(
            challenge_token=payload.get("identity_verification_challenge"),
            chat_category=_esc_cat,
        ) if _esc_cat else None

        if not _esc_challenge:
            nudge = (
                "To complete your escalation request, please verify your email address. "
                "Enter your email and we'll send you a quick verification code."
            )
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=nudge,
                response_mode="chat",
            )
            _touch_last_message_at(conversation)
            publish_chat_response(conversation.conversation_id, {
                "status": "await_escalation_verification",
                "response_type": "message",
                "message": nudge,
                "answer": nudge,
                "confidence": 1.0,
                "access_status": "awaiting_verification",
                "sources": [],
                "identity_verification_offer": True,
            })
            return {
                "status": "await_escalation_verification",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

        # Challenge verified — stamp email and promote escalation to active
        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "visitor_email": _esc_challenge.email,
            "intent": "",
        })
        conversation.reload()

        stamp_email_on_web_visitor(conversation, _esc_challenge.email, verified=True)

        _complete_approved_escalation(conversation.name)

        return {
            "status": "escalation_verified",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # Store visitor message for all non-category-click, non-idv-advance cases
    if not _is_idv_advance:
        add_message(
            conversation=conversation,
            sender_type=sender_type,
            message=message,
            response_mode="chat",
        )
        _touch_last_message_at(conversation)

    # ── Await name ──────────────────────────────────────────────────────────────
    if intent == "await_name":
        visitor_name = _extract_name_from_input(message)[:100]
        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "visitor_name": visitor_name,
            "intent": "",
        })
        conversation.reload()
        cat_data = _send_category_picker(conversation, greeting_name=visitor_name)
        if not cat_data:
            # No external categories configured — skip picker, send direct greeting
            ready = f"Nice to meet you, {visitor_name}! How can I help you today?"
            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=ready,
                response_mode="chat",
            )
            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": ready,
                "answer": ready,
                "agent_name": get_agent_nickname(conversation),
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
            })

        return {
            "status": "name_collected",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Await close confirmation ────────────────────────────────────────────────
    if intent == "await_close_confirm":
        if _is_no_more_help(message):
            visitor_name = conversation.visitor_name or None
            name_part = f", {visitor_name}" if visitor_name else ""
            farewell = (
                f"Thank you for reaching out{name_part}. "
                "It was a pleasure assisting you. "
                "Feel free to come back whenever you need help. "
                "Have a wonderful day!"
            )
            _close_conversation_gracefully(conversation, farewell=farewell)
            frappe.db.commit()
            return {
                "status": "closed",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }
        else:
            # Visitor still has something to ask — resume normal flow
            frappe.db.set_value("Nexus Live Conversation", conversation.name, "intent", "")
            _enqueue_ai_response(conversation.conversation_id, payload)
            return {
                "status": "processing",
                "conversation": conversation.name,
                "conversation_id": conversation_id,
            }

    # ── Post-escalation: first visitor message after human agent resolved ──────
    if intent == "post_escalation":
        frappe.db.set_value("Nexus Live Conversation", conversation.name, "intent", "")
        payload["_post_escalation"] = True

    # ── Onboarding: visitor's first reply after the mandatory business inquiry ──
    if intent == "onboarding_business":
        frappe.db.set_value("Nexus Live Conversation", conversation.name, "intent", "")
        payload["_onboarding_business_response"] = True
        _enqueue_ai_response(conversation.conversation_id, payload)
        return {
            "status": "processing",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Normal flow: detect closing signals ────────────────────────────────────
    if _is_closing_message(message):
        close_prompt = (
            "I'm glad I could help! Before we wrap up, "
            "is there anything else I can assist you with today?"
        )
        frappe.db.set_value(
            "Nexus Live Conversation", conversation.name, "intent", "await_close_confirm"
        )
        conversation.reload()
        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            message=close_prompt,
            response_mode="chat",
        )
        publish_chat_response(conversation.conversation_id, {
            "status": "success",
            "response_type": "message",
            "message": close_prompt,
            "answer": close_prompt,
            "agent_name": get_agent_nickname(conversation),
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
        })
        return {
            "status": "close_pending",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # ── Nexy intent detection ──────────────────────────────────────────────────
    # Check if the visitor's message signals a Nexy-triggering intent (price, demo,
    # consultancy, etc.) and the current category is not already a Nexy category.
    _should_check_nexy = (
        not getattr(conversation, "nexy_handover_category", None)
        and conversation.chat_category
    )
    if _should_check_nexy:
        from digitz_ai_nexus_live.services.nexy_handover_service import (
            detect_nexy_intent,
            initiate_nexy_handover,
            _is_already_nexy,
        )
        if detect_nexy_intent(message) and not _is_already_nexy(conversation):
            handover_status = initiate_nexy_handover(conversation, payload)
            if handover_status == "await_nexy_verification":
                _nexy_cat_name = getattr(conversation, "nexy_handover_category", None)
                _nexy_label = (
                    frappe.db.get_value("Nexus Chat Category", _nexy_cat_name, "category_label")
                    if _nexy_cat_name else "Nexy"
                )
                verification_prompt = (
                    f"I can connect you to **{_nexy_label}** for a more personalised response. "
                    "To proceed, please verify your identity — enter your email address below."
                )
                add_message(
                    conversation=conversation,
                    sender_type="AI Agent",
                    message=verification_prompt,
                    response_mode="chat",
                )
                _touch_last_message_at(conversation)
                publish_chat_response(conversation.conversation_id, {
                    "status": "await_nexy_verification",
                    "response_type": "message",
                    "message": verification_prompt,
                    "answer": verification_prompt,
                    "agent_name": get_agent_nickname(conversation),
                    "confidence": 1.0,
                    "access_status": "awaiting_verification",
                    "sources": [],
                    "identity_verification_offer": True,
                })
                return {
                    "status": "await_nexy_verification",
                    "conversation": conversation.name,
                    "conversation_id": conversation_id,
                }
            elif handover_status == "nexy_handover_complete":
                # No verification needed — handover completed immediately
                _nexy_label = (
                    frappe.db.get_value(
                        "Nexus Chat Category",
                        getattr(conversation, "chat_category", None),
                        "category_label",
                    ) or "Nexy"
                )
                handover_msg = (
                    f"You've been connected to **{_nexy_label}**. "
                    "How can I help you today?"
                )
                add_message(
                    conversation=conversation,
                    sender_type="AI Agent",
                    message=handover_msg,
                    response_mode="chat",
                )
                _touch_last_message_at(conversation)
                publish_chat_response(conversation.conversation_id, {
                    "status": "nexy_handover_complete",
                    "response_type": "message",
                    "message": handover_msg,
                    "answer": handover_msg,
                    "agent_name": get_agent_nickname(conversation),
                    "confidence": 1.0,
                    "access_status": "conversational",
                    "sources": [],
                })
                return {
                    "status": "nexy_handover_complete",
                    "conversation": conversation.name,
                    "conversation_id": conversation_id,
                }

    # ── AI processing ───────────────────────────────────────────────────────────
    _enqueue_ai_response(conversation.conversation_id, payload)

    return {
        "status": "processing",
        "conversation": conversation.name,
        "conversation_id": conversation_id,
    }


# ── Background AI job ──────────────────────────────────────────────────────────

def _enqueue_ai_response(conversation_id, payload):
    frappe.enqueue(
        "digitz_ai_nexus_live.services.live_chat_service._process_ai_response",
        conversation_id=conversation_id,
        payload_json=json.dumps(payload, default=str),
        queue="short",
        timeout=120,
        now=frappe.flags.in_test,
    )
    # _process_ai_response(
    #     conversation_id=conversation_id,
    #     payload_json=json.dumps(payload, default=str),
    # )

def _dispatch_companion_controller(controller_type, conversation, agent, payload, core_payload):
    """
    Route to the correct Nexy companion controller based on companion_controller_type
    set on the Nexus Chat Category. Defaults to business_companion for any missing,
    unknown, or legacy value — ensuring backward compatibility with existing conversations.

    To add a new Nexy role:
    1. Add the option to Nexus Chat Category.companion_controller_type
    2. Create the controller module under digitz_ai_nexus/nexus_companion/services/
    3. Add an elif branch here pointing to handle_companion_turn in that module
    """
    if controller_type == "customer_support":
        from digitz_ai_nexus.nexus_companion.services.support_companion_controller import (
            handle_companion_turn,
        )
    else:
        from digitz_ai_nexus.nexus_companion.services.business_companion_controller import (
            handle_companion_turn,
        )

    return handle_companion_turn(
        conversation=conversation,
        agent=agent,
        payload=payload,
        core_payload=core_payload,
    )


def _process_ai_response(conversation_id, payload_json):
    """Background job: run the AI pipeline and push the answer via realtime."""
    try:
        payload = json.loads(payload_json)
        conversation = get_conversation(conversation_id)

        if not conversation:
            return

        agent = frappe.get_doc("Nexus AI Agent Profile", conversation.assigned_agent)
        behavior = _resolve_behavior(payload=payload, conversation=conversation, agent=agent)

        set_agent_status(
            agent,
            "Responding",
            conversation=conversation.name,
            remarks="AI agent responding in live chat.",
        )

        publish_chat_typing(conversation_id)

        core_payload = build_core_chat_payload(
            payload=payload,
            conversation=conversation,
            agent=agent,
            behavior=behavior,
        )

        # Nexy Companion enrichment — role profile, communication rules, agent_loop behaviour
        try:
            from digitz_ai_nexus_nexy.services.nexy_live_response_service import (
                try_enrich_with_companion_context,
            )

            core_payload = try_enrich_with_companion_context(
                conversation,
                agent,
                core_payload,
            )
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Nexy: try_enrich_with_companion_context failed",
            )

        # Public Access Mode: desk simulation should behave like a fresh public visitor.
        if payload.get("force_public_only") and getattr(conversation, "user_type", "") == "Desk User":
            core_payload["chat_history"] = []

        # Nexus Companion context enrichment.
        core_payload["conversation_name"] = conversation.name

        _is_companion_mode = int(
            (core_payload.get("ai_profile") or {}).get("companion_mode") or 0
        )

        if _is_companion_mode:
            try:
                from digitz_ai_nexus.nexus_companion.services.companion_context_service import (
                    build_companion_context,
                )

                _companion_tenant = (
                    payload.get("tenant")
                    or getattr(conversation, "tenant", "")
                    or (core_payload.get("ai_profile") or {}).get("tenant")
                    or ""
                )

                core_payload["companion_context"] = build_companion_context(
                    conversation,
                    agent,
                    _companion_tenant,
                )

                # Keep this as advisory metadata.
                # The controller will still own the flow.
                core_payload["response_mode"] = "companion_advisor"

            except Exception:
                frappe.log_error(
                    frappe.get_traceback(),
                    "Nexus Companion: build_companion_context failed",
                )

        # ------------------------------------------------------------------
        # Core AI response
        # ------------------------------------------------------------------
        try:
            _is_companion_mode = int(
                (core_payload.get("ai_profile") or {}).get("companion_mode") or 0
            )

            if _is_companion_mode:
                _controller_type = (core_payload.get("ai_profile") or {}).get(
                    "companion_controller_type"
                ) or "business_companion"

                core_response = _dispatch_companion_controller(
                    _controller_type, conversation, agent, payload, core_payload
                )
            else:
                core_response = answer_query(core_payload)

        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Nexus Live Chat Core Answer Failed",
            )

            set_agent_status(
                agent,
                "Waiting",
                conversation=conversation.name,
                remarks="AI agent response failed. Waiting for next visitor message.",
            )

            publish_chat_error(conversation_id, "AI response failed. Please try again.")
            return

        if not isinstance(core_response, dict):
            core_response = {}

        _controller_led_companion = bool(core_response.get("companion_controller"))

        answer = core_response.get("answer")
        confidence = core_response.get("confidence")
        sources = core_response.get("sources") or []
        retrieval_debug = core_response.get("retrieval_debug") or {}

        debug_info = None
        try:
            _payload_user = (payload.get("user") or {}).get("name")
            if (
                _payload_user
                and "System Manager" in frappe.get_roles(_payload_user)
                and _is_retrieval_debug_enabled()
            ):
                debug_info = _build_retrieval_debug_info(core_response, core_payload)
        except Exception:
            pass

        fallback_message = (
            behavior.fallback_message
            if behavior and behavior.fallback_message
            else DEFAULT_FALLBACK_ANSWER
        )

        if not answer:
            answer = fallback_message

        if answer.strip() == DEFAULT_FALLBACK_ANSWER and fallback_message != DEFAULT_FALLBACK_ANSWER:
            answer = fallback_message

        # Public identity fallback.
        is_fallback = bool(core_response.get("fallback_used") or not core_response.get("answer"))
        is_public_visitor = bool(behavior and behavior.identity_type == "Public")
        _companion_wants_email_verification = bool(core_response.get("requires_email_verification"))
        _companion_no_verify = (
            (bool(core_response.get("companion_controller")) and not _companion_wants_email_verification)
            or core_response.get("verification_prompt_allowed") is False
            or core_response.get("access_status") == "controlled_no_context"
        )
        identity_verification_offer = (
            (is_fallback and is_public_visitor and not _companion_no_verify)
            or _companion_wants_email_verification
        )

        if identity_verification_offer:
            # Preserve the companion-controller answer when it explicitly set
            # requires_email_verification and returned its own answer text.
            # Only use the public-knowledge fallback for pure RAG-fallback cases
            # where no controller answer exists.
            if not (_companion_wants_email_verification and core_response.get("answer")):
                answer = PUBLIC_IDENTITY_FALLBACK

        threshold = (
            behavior.confidence_threshold
            if behavior and behavior.confidence_threshold is not None
            else 0.65
        )

        is_real_answer = (
            not is_fallback
            and not identity_verification_offer
            and core_response.get("access_status") == "allowed"
        )

        _is_companion_mode = int(
            (core_payload.get("ai_profile") or {}).get("companion_mode") or 0
        )

        # Low-confidence wrapper only for non-companion RAG answers.
        if (
            is_real_answer
            and confidence is not None
            and confidence < threshold
            and not _is_companion_mode
        ):
            answer = _wrap_low_confidence_answer(
                visitor_message=payload.get("message") or payload.get("query") or "",
                raw_answer=answer,
                confidence=confidence,
            )

        add_message(
            conversation=conversation,
            sender_type="AI Agent",
            sender_agent=agent.name,
            message=answer,
            response_mode="chat",
            confidence=confidence,
            sources=sources,
            retrieval_debug=retrieval_debug,
        )

        set_agent_status(
            agent,
            "Waiting",
            conversation=conversation.name,
            remarks="Waiting for next visitor message.",
        )

        # ------------------------------------------------------------------
        # Companion conversion action
        # ------------------------------------------------------------------
        # In controller-led companion mode, the controller owns CTA/conversion.
        # Therefore this must come from core_response only.
        _companion_conversion_action = None

        if _controller_led_companion:
            _companion_conversion_action = core_response.get("conversion_action")

        # ------------------------------------------------------------------
        # Legacy companion journey post-processing
        # ------------------------------------------------------------------
        # Run this only for old LLM-led companion mode.
        # Do NOT run this after controller-led companion mode, otherwise the old
        # stage/score/CTA logic can override the controller.
        if (
            int((core_payload.get("ai_profile") or {}).get("companion_mode") or 0)
            and not _controller_led_companion
        ):
            try:
                from digitz_ai_nexus.nexus_companion.services.signal_classifier import (
                    classify_signal,
                )
                from digitz_ai_nexus.nexus_companion.services.enquiry_service import (
                    update_enquiry,
                    advance_journey_stage_from_signal,
                    advance_journey_stage,
                    check_escalation_threshold,
                    check_trigger_keywords,
                    get_or_create_enquiry,
                    get_conversion_action,
                )

                conversation.reload()

                _visitor_message = payload.get("message") or payload.get("query") or ""
                _companion_playbook = (
                    core_payload.get("ai_profile") or {}
                ).get("companion_playbook")

                get_or_create_enquiry(conversation)

                _conv_context = core_payload.get("conversation_context") or ""
                _signal = classify_signal(_visitor_message, _conv_context)

                update_enquiry(
                    conversation,
                    discovery_delta={},
                    signal=_signal,
                )

                advance_journey_stage_from_signal(
                    conversation,
                    _signal.get("signal_type", "CURIOUS"),
                )

                conversation.reload()
                advance_journey_stage(conversation)

                conversation.reload()
                _companion_conversion_action = get_conversion_action(conversation)

                if check_escalation_threshold(conversation, _companion_playbook) or (
                    _companion_playbook
                    and check_trigger_keywords(_visitor_message, _companion_playbook)
                ):
                    frappe.db.set_value(
                        "Nexus Live Conversation",
                        conversation.name,
                        "companion_journey_stage",
                        "ESCALATED",
                        update_modified=False,
                    )

                    if conversation.companion_enquiry:
                        frappe.db.set_value(
                            "Nexus Companion Enquiry",
                            conversation.companion_enquiry,
                            "enquiry_stage",
                            "ESCALATED",
                        )

            except Exception:
                frappe.log_error(
                    frappe.get_traceback(),
                    "Nexus Companion: signal/stage update failed",
                )

        # ------------------------------------------------------------------
        # Escalation handling
        # ------------------------------------------------------------------
        escalation_enabled = (
            bool(behavior.escalation_enabled)
            if behavior and behavior.escalation_enabled is not None
            else True
        )

        escalation_created = None
        _esc_notice = None
        _esc_calendly = None
        _pre_escalation_email_prompt = None

        category_allows_escalation = False
        if conversation.chat_category:
            category_allows_escalation = bool(
                frappe.db.get_value(
                    "Nexus Chat Category",
                    conversation.chat_category,
                    "enable_escalation",
                )
            )

        _current_esc_status = getattr(conversation, "escalation_status", None) or "None"
        already_pending = _current_esc_status in ("Requested", "Pending", "Accepted")

        user_requested_human = bool(core_response.get("user_requested_human"))

        # Escalation is triggered only by explicit visitor request.
        if (
            not already_pending
            and escalation_enabled
            and category_allows_escalation
            and user_requested_human
        ):
            if not conversation.visitor_email:
                frappe.db.set_value(
                    "Nexus Live Conversation",
                    conversation.name,
                    "intent",
                    "await_pre_escalation_verification",
                )

                _pre_escalation_email_prompt = (
                    "I'd be happy to connect you with our team. To proceed, could you please "
                    "share your email address? We'll send you a quick verification code."
                )

                add_message(
                    conversation=conversation,
                    sender_type="AI Agent",
                    message=_pre_escalation_email_prompt,
                    response_mode="chat",
                )

            else:
                escalation_created = create_escalation(
                    conversation=conversation,
                    reason="User Requested Human",
                    from_agent=agent,
                    confidence=None,
                    remarks="User explicitly requested escalation to a human agent.",
                )

                if escalation_created:
                    _esc_calendly = getattr(agent, "calendly_link", None) or None

                    if _esc_calendly:
                        _esc_notice = (
                            "Your request to connect with our team has been received. "
                            "An agent will respond based on their availability. "
                            "Alternatively, you can book a meeting directly using the calendar below."
                        )
                    else:
                        _esc_notice = (
                            "Your request to connect with our team has been received. "
                            "A desk agent will review your chat shortly and you'll be updated "
                            "based on their availability. In the meantime, feel free to continue "
                            "asking questions — our AI assistant is here to help."
                        )

                    add_message(
                        conversation=conversation,
                        sender_type="AI Agent",
                        message=_esc_notice,
                        response_mode="chat",
                    )

        resolved_context = payload.get("_resolved_tenant_context") or {}

        correlated_questions = (
            []
            if _is_companion_mode
            else (core_response.get("correlated_questions") or [])
        )

        _publish_payload = {
            "status": "success",
            "response_type": "message",
            "conversation": conversation.name,
            "agent": agent.name,
            "agent_code": agent.agent_code,
            "agent_name": get_agent_nickname(conversation, agent),

            "message": answer,
            "answer": answer,
            "confidence": confidence,
            "sources": sources,
            "correlated_questions": correlated_questions,

            "escalation_requested": bool(escalation_created),
            "escalation": escalation_created.name if escalation_created else None,

            "confidence_threshold": threshold,
            "fallback_used": 1 if core_response.get("fallback_used") else 0,
            "identity_verification_offer": identity_verification_offer,
            "email_followup_offer": bool(core_response.get("email_followup_offer")),
            "gap_name": core_response.get("gap_name") or None,
        }

        # Forward companion verification metadata so the frontend has full context.
        if _companion_wants_email_verification:
            _publish_payload["requires_email_verification"] = True
            _publish_payload["verification_prompt_allowed"] = bool(
                core_response.get("verification_prompt_allowed")
            )
            _publish_payload["verification_stage"] = core_response.get("verification_stage")
            _publish_payload["verification_purpose"] = core_response.get("verification_purpose")
            _publish_payload["pending_action"] = core_response.get("pending_action")
            _publish_payload["booking_blocked_until_verified"] = bool(
                core_response.get("booking_blocked_until_verified")
            )
            _publish_payload["access_status"] = core_response.get("access_status") or "awaiting_verification"

        publish_chat_response(conversation_id, {
            **_publish_payload,

            "conversion_action": _companion_conversion_action,

            "tenant": payload.get("tenant"),
            "channel": payload.get("channel"),
            "resolved_tenant_context": resolved_context,
            "debug_info": debug_info,
        })

        if escalation_created and _esc_notice:
            publish_chat_response(conversation.conversation_id, {
                "status": "escalation_requested",
                "response_type": "message",
                "message": _esc_notice,
                "answer": _esc_notice,
                "confidence": 1.0,
                "sources": [],
                "escalation_requested": True,
                "escalation": escalation_created.name,
                "calendly_link": _esc_calendly,
            })

        if _pre_escalation_email_prompt:
            publish_chat_response(conversation.conversation_id, {
                "status": "await_pre_escalation_verification",
                "response_type": "message",
                "message": _pre_escalation_email_prompt,
                "answer": _pre_escalation_email_prompt,
                "confidence": 1.0,
                "sources": [],
                "identity_verification_offer": True,
            })

        # Soft human nudge only for non-companion weak answers.
        _is_weak_answer = is_fallback or (
            is_real_answer and confidence is not None and confidence < threshold
        )

        if (
            _is_weak_answer
            and category_allows_escalation
            and not already_pending
            and not user_requested_human
            and not _is_companion_mode
        ):
            _human_nudge = (
                "If you'd like to speak with someone from our team directly, just let me know."
            )

            add_message(
                conversation=conversation,
                sender_type="AI Agent",
                message=_human_nudge,
                response_mode="chat",
            )

            publish_chat_response(conversation.conversation_id, {
                "status": "success",
                "response_type": "message",
                "message": _human_nudge,
                "answer": _human_nudge,
                "agent_name": get_agent_nickname(conversation, agent),
                "confidence": 1.0,
                "sources": [],
            })

        # WhatsApp delivery fork.
        try:
            from digitz_ai_nexus_live.services.whatsapp_service import (
                get_whatsapp_delivery_for_conversation,
                send_whatsapp_reply,
            )

            _wa_account, _wa_phone = get_whatsapp_delivery_for_conversation(conversation)

            if _wa_account and _wa_phone:
                send_whatsapp_reply(_wa_phone, answer, _wa_account)

        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Nexus WhatsApp: outbound delivery failed",
            )

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Nexus Live Chat Background Processing Failed",
        )

        try:
            conversation = get_conversation(conversation_id)
            if conversation and conversation.assigned_agent:
                set_agent_status(
                    conversation.assigned_agent,
                    "Waiting",
                    conversation=conversation.name,
                    remarks="Background job failed; agent reset to Waiting.",
                )
        except Exception:
            pass

        publish_chat_error(conversation_id, "An error occurred processing your message.")

# ── Helpers ────────────────────────────────────────────────────────────────────

def _touch_last_message_at(conversation):
    from frappe.utils import now_datetime
    frappe.db.set_value(
        "Nexus Live Conversation",
        conversation.name,
        "last_message_at",
        now_datetime(),
        update_modified=False,
    )


def _get_website_chat_channels_for_conversation(conversation):
    filters = {"enabled": 1, "channel_type": "Website Chat"}
    tenant = getattr(conversation, "tenant", None)
    if not tenant and getattr(conversation, "channel", None):
        tenant = frappe.db.get_value(
            "Nexus Live Channel",
            conversation.channel,
            "tenant",
        )
    if tenant:
        filters["tenant"] = tenant

    return frappe.get_all(
        "Nexus Live Channel",
        filters=filters,
        pluck="name",
    )


def _filter_categories_with_active_routes(categories):
    if not categories:
        return []

    category_names = [c.name for c in categories if c.get("name")]
    if not category_names:
        return []

    route_filters = {
        "chat_category": ["in", category_names],
        "enabled": 1,
        "published": 1,
    }
    # Categories are already tenant-scoped; add explicit tenant filter when available
    tenant = next((c.get("tenant") for c in categories if c.get("tenant")), None)
    if tenant:
        route_filters["tenant"] = tenant

    routed_names = set(frappe.get_all(
        "Nexus Category Identity Route",
        filters=route_filters,
        pluck="chat_category",
    ))

    return [c for c in categories if c.name in routed_names]


def _get_faq_questions(category_name, exclude_name=None):
    """Return enabled FAQ rows for a category ordered by display_order."""
    filters = {"parent": category_name, "parenttype": "Nexus Chat Category", "enabled": 1}
    rows = frappe.get_all(
        "Nexus Chat Category FAQ",
        filters=filters,
        fields=["name", "question", "display_order"],
        order_by="display_order asc, idx asc",
    )
    if exclude_name:
        rows = [r for r in rows if r["name"] != exclude_name]
    return [{"name": r["name"], "question": r["question"]} for r in rows]


# ── Idle timeout scheduler ─────────────────────────────────────────────────────

def close_idle_conversations():
    """
    Scheduled job: close conversations idle beyond the global chat_idle_timeout_minutes
    configured in Nexus Settings (default 10 minutes).
    """
    from frappe.utils import now_datetime

    try:
        timeout_minutes = int(
            frappe.db.get_single_value("Nexus Settings", "chat_idle_timeout_minutes") or 10
        )
    except Exception:
        timeout_minutes = 10

    open_conversations = frappe.get_all(
        "Nexus Live Conversation",
        filters={"status": ["in", ["Open", "Responding", "Escalated"]]},
        fields=["name", "conversation_id", "last_message_at", "started_on", "visitor_name"],
    )

    now = now_datetime()

    for conv in open_conversations:
        last_activity = conv.last_message_at or conv.started_on
        if not last_activity:
            continue

        idle_minutes = (now - last_activity).total_seconds() / 60
        if idle_minutes < timeout_minutes:
            continue

        farewell = (
            "We haven't heard from you for a while, so this conversation is now being closed. "
            "Thank you for reaching out — feel free to start a new conversation "
            "whenever you are available. We look forward to hearing from you!"
        )

        try:
            conversation_doc = frappe.get_doc("Nexus Live Conversation", conv.name)
            _close_conversation_gracefully(conversation_doc, farewell=farewell)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Nexus Idle Close Failed")
            frappe.db.set_value("Nexus Live Conversation", conv.name, {
                "status": "Closed",
                "closed_on": now,
                "intent": "",
            })

    frappe.db.commit()


# ── Low-confidence answer wrapper ──────────────────────────────────────────────

def _wrap_low_confidence_answer(visitor_message, raw_answer, confidence):
    """
    When the RAG pipeline returns a real answer but below the confidence threshold,
    ask the LLM to reframe it with an honest preamble and an invitation to refine
    the query. Falls back to the raw answer if the LLM call fails.
    """
    from digitz_ai_nexus.engine.llm import generate_answer

    prompt = (
        "You are a helpful enterprise AI assistant.\n\n"
        f"User's question: {visitor_message}\n\n"
        f"Retrieved answer:\n{raw_answer}\n\n"
        "Your task:\n"
        "1. Present the retrieved information clearly, helpfully, and with confidence.\n"
        "2. Close with one short, natural invitation for the user to confirm it covers "
        "what they needed, or to ask a follow-up if they want more detail.\n\n"
        "Important rules:\n"
        "- Do NOT open with any negative, hedging, or uncertainty statement.\n"
        "- Do NOT say 'this might not be exactly what you were looking for' or anything similar.\n"
        "- Do NOT mention confidence scores, percentages, or any technical terms.\n"
        "- Do NOT start with the word 'I'.\n"
        "- Keep a warm, professional tone throughout.\n"
        "- Do not invent or add any information beyond what is in the retrieved answer.\n"
        "- Keep the response concise."
    )

    try:
        wrapped = (generate_answer(prompt) or "").strip()
        return wrapped if wrapped else raw_answer
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Low Confidence Wrap Failed")
        return raw_answer


# ── Retrieval debug helpers ────────────────────────────────────────────────────

def _is_retrieval_debug_enabled():
    try:
        settings = frappe.get_single("Nexus Settings")
        return bool(getattr(settings, "enable_retrieval_debug", 0))
    except Exception:
        return False


def _build_retrieval_debug_info(core_response, core_payload):
    rr = (core_response.get("retrieval_result") or {}) if isinstance(core_response, dict) else {}
    chunks = rr.get("results") or []

    top_chunks = []
    for chunk in chunks[:5]:
        top_chunks.append({
            "chunk": chunk.get("chunk"),
            "title": (
                chunk.get("knowledge_source_title")
                or chunk.get("chunk_preview")
                or chunk.get("title")
                or "(untitled)"
            ),
            "score": round(float(chunk.get("final_score") or chunk.get("hybrid_score") or chunk.get("score") or 0), 4),
            "vector_score": round(float(chunk.get("vector_score") or 0), 4),
            "keyword_score": round(float(chunk.get("keyword_score") or 0), 4),
            "access_policy": chunk.get("access_policy"),
        })

    return {
        "access_status": rr.get("access_status") or core_response.get("access_status"),
        "allowed_access_policies": core_payload.get("allowed_access_policies") or [],
        "access_cap_applied": core_payload.get("_access_cap_applied") or "unknown",
        "candidate_count": rr.get("candidate_count") or 0,
        "original_candidate_count": rr.get("original_candidate_count") or 0,
        "allowed_count": rr.get("allowed_count") or 0,
        "denied_count": rr.get("denied_count") or 0,
        "final_result_count": len(chunks),
        "confidence": round(float(core_response.get("confidence") or 0), 4),
        "fallback_used": bool(core_response.get("fallback_used")),
        "features": rr.get("features") or {},
        "question_first": rr.get("question_first") or {},
        "top_chunks": top_chunks,
    }
