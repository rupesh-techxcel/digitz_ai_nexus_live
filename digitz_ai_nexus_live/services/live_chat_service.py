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
CHAT_RESPONSE_SENTENCE_LIMIT = 6
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
    if conversation.channel:
        cat_filters["channel"] = conversation.channel

    categories = frappe.get_all(
        "Nexus Chat Category",
        filters=cat_filters,
        fields=["name", "category_code", "category_label", "description", "display_order"],
        order_by="display_order asc",
    )

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

    resolved_intents = resolve_intents_for_profile(ai_profile.get("name") if ai_profile else None)

    resolved_identity_type = (
        ai_profile.get("identity_type")
        or payload.get("identity_type")
    )
    # Public identity or unauthenticated guest → restrict to "Public" policies only.
    # Applies regardless of whether an AI profile is assigned — a named profile does
    # not grant elevated knowledge access to public visitors.
    force_public_only = bool(
        resolved_identity_type == "Public"
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
            payload.get("user_type", "Guest") != "Guest"
            and bool(payload.get("user"))
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
                "agent_name": get_agent_nickname(conversation, agent),
                "agent_instance": getattr(conversation, "agent_profile_instance", None),
                "initial_messages": [],
            }

        # Widget opened with no initial message.
        # If Internal/Both categories exist on this channel, show a category picker
        # so desk users can route to the right knowledge domain.
        # Otherwise fall back to a direct greeting.
        has_internal_categories = frappe.db.exists(
            "Nexus Chat Category",
            {
                "channel": conversation.channel,
                "enabled": 1,
                "published": 1,
                "visibility": ["in", ["Internal", "Both"]],
            },
        )

        if has_internal_categories:
            category_data = _send_category_picker(conversation, publish=False, is_internal=True)
            return {
                "status": "await_category",
                "conversation": conversation.name,
                "conversation_id": conversation.conversation_id,
                "agent": agent.name,
                "agent_code": agent.agent_code,
                "agent_name": get_agent_nickname(conversation, agent),
                "agent_instance": getattr(conversation, "agent_profile_instance", None),
                "initial_messages": [category_data],
            }

        greeting = "Hello! Welcome. I'm your AI assistant and I'm here to help you today."
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
            "agent_name": get_agent_nickname(conversation, agent),
            "agent_instance": getattr(conversation, "agent_profile_instance", None),
            "initial_messages": [{
                "status": "success",
                "response_type": "message",
                "message": greeting,
                "answer": greeting,
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
        from digitz_ai_nexus_live.services.identity_resolver import (
            resolve_identity_registry_name,
            resolve_identity_safeguard_access_categories,
            resolve_identity_type,
        )
        is_authenticated = (
            payload.get("user_type", "Guest") != "Guest"
            and bool(payload.get("user"))
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

    # Send greeting
    greeting = (
        "Hello! Welcome. I'm your AI assistant and I'm here to help you today."
    )
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
        "confidence": 1.0,
        "access_status": "conversational",
        "sources": [],
        "conversation_id": conversation.conversation_id,
    }
    initial_messages.append(greeting_data)

    # Determine next step: name collection or category selection
    behavior = _resolve_behavior(payload, conversation=conversation)
    needs_name = (
        getattr(behavior, "collect_visitor_name", 0)
        and not conversation.visitor_name
        and not payload.get("visitor_name")
    )

    if needs_name:
        name_prompt = "Before we begin, could I get your name, please?"
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
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
            "conversation_id": conversation.conversation_id,
        }
        initial_messages.append(name_data)
    elif not chat_category:
        # No category selected yet — show category picker.
        # Deliver via HTTP response only (publish=False) to avoid duplicate
        # display if the socket also receives the event later.
        category_data = _send_category_picker(conversation, publish=False)
        if category_data:
            category_data["conversation_id"] = conversation.conversation_id
            initial_messages.append(category_data)
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
                "confidence": 1.0,
                "access_status": "conversational",
                "sources": [],
                "conversation_id": conversation.conversation_id,
            }
            initial_messages.append(ready_data)

    return {
        "status": "awaiting_name" if needs_name else ("await_category" if not chat_category else "processing"),
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
            # Acknowledge to visitor
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
        _is_internal_conv = getattr(conversation, "user_type", "") == "Desk User"
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

        cat = frappe.db.get_value(
            "Nexus Chat Category",
            {"category_code": category_code, "enabled": 1, "published": 1},
            ["name", "category_label"],
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

        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "chat_category": cat.name,
            "intent": "",
        })
        conversation.reload()
        payload["chat_category"] = category_code

        visitor_name = conversation.visitor_name or ""
        name_part = f", {visitor_name}" if visitor_name else ""
        ack = (
            f"Perfect{name_part}! I'll be assisting you with {cat.category_label}. "
            "What would you like to know?"
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
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
        })

        return {
            "status": "category_selected",
            "conversation": conversation.name,
            "conversation_id": conversation_id,
        }

    # Store visitor message for all non-category-click cases
    add_message(
        conversation=conversation,
        sender_type=sender_type,
        message=message,
        response_mode="chat",
    )
    _touch_last_message_at(conversation)

    # ── Await name ──────────────────────────────────────────────────────────────
    if intent == "await_name":
        visitor_name = message.strip()[:100]
        frappe.db.set_value("Nexus Live Conversation", conversation.name, {
            "visitor_name": visitor_name,
            "intent": "",
        })
        conversation.reload()
        _send_category_picker(conversation, greeting_name=visitor_name)

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
            "confidence": 1.0,
            "access_status": "conversational",
            "sources": [],
        })
        return {
            "status": "close_pending",
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

        try:
            core_response = answer_query(core_payload)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Nexus Live Chat Core Answer Failed")

            set_agent_status(
                agent,
                "Waiting",
                conversation=conversation.name,
                remarks="AI agent response failed. Waiting for next visitor message.",
            )

            publish_chat_error(conversation_id, "AI response failed. Please try again.")
            return

        answer = core_response.get("answer") if isinstance(core_response, dict) else None
        confidence = core_response.get("confidence") if isinstance(core_response, dict) else None
        sources = core_response.get("sources") if isinstance(core_response, dict) else []
        retrieval_debug = core_response.get("retrieval_debug") if isinstance(core_response, dict) else {}

        fallback_message = (
            behavior.fallback_message
            if behavior and behavior.fallback_message
            else DEFAULT_FALLBACK_ANSWER
        )

        if not answer:
            answer = fallback_message

        if answer.strip() == DEFAULT_FALLBACK_ANSWER and fallback_message != DEFAULT_FALLBACK_ANSWER:
            answer = fallback_message

        # When a Public visitor hits a fallback, the dead-end message is replaced
        # with an identity verification offer — the visitor can upgrade from the
        # default Public identity by verifying their email via OTP.
        is_fallback = bool(core_response.get("fallback_used") or not core_response.get("answer"))
        is_public_visitor = bool(behavior and behavior.identity_type == "Public")
        identity_verification_offer = is_fallback and is_public_visitor
        if identity_verification_offer:
            answer = PUBLIC_IDENTITY_FALLBACK

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

        threshold = (
            behavior.confidence_threshold
            if behavior and behavior.confidence_threshold is not None
            else 0.65
        )

        escalation_enabled = (
            bool(behavior.escalation_enabled)
            if behavior and behavior.escalation_enabled is not None
            else True
        )

        escalation_created = None

        # Only escalate to human if the category has enable_escalation checked
        category_allows_escalation = False
        if conversation.chat_category:
            category_allows_escalation = bool(
                frappe.db.get_value(
                    "Nexus Chat Category",
                    conversation.chat_category,
                    "enable_escalation",
                )
            )

        user_requested_human = bool(core_response.get("user_requested_human"))
        if user_requested_human and escalation_enabled and category_allows_escalation:
            escalation_created = create_escalation(
                conversation=conversation,
                reason="User Requested Human",
                from_agent=agent,
                confidence=confidence,
                remarks="User explicitly requested escalation to a human agent.",
            )

        resolved_context = payload.get("_resolved_tenant_context") or {}

        publish_chat_response(conversation_id, {
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

            "escalated": bool(escalation_created),
            "escalation": escalation_created.name if escalation_created else None,

            "confidence_threshold": threshold,
            "fallback_used": 1 if core_response.get("fallback_used") else 0,
            "identity_verification_offer": identity_verification_offer,

            "tenant": payload.get("tenant"),
            "channel": payload.get("channel"),
            "resolved_tenant_context": resolved_context,
        })

    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Live Chat Background Processing Failed")
        try:
            # Ensure agent is not left stuck in Responding status
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
