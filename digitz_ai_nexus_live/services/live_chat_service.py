import json

import frappe

from digitz_ai_nexus_live.services.agent_router import assign_agent
from digitz_ai_nexus_live.services.agent_service import (
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
        require_tenant=True,
    )


def _build_ai_profile_dict(behavior):
    if not behavior:
        return {}

    return {
        "name": behavior.profile_name or "",
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
    force_public_only = bool(
        not ai_profile.get("name")
        and (
            resolved_identity_type == "Public"
            or payload.get("user_type", "Guest") == "Guest"
        )
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
        return resolve_behavior_from_chat_category(chat_category, identity_type, is_authenticated)

    if agent:
        return get_agent_behavior(agent)

    return None


def start_live_chat(payload):
    payload = payload or {}

    message = payload.get("message")

    if not message:
        frappe.throw("Message is required.")

    payload["message"] = message
    payload["conversation_type"] = "Chat"
    payload = apply_session_user_context(payload)

    if payload.get("chat_category") and not is_internal_session_user():
        from digitz_ai_nexus_live.services.identity_verification import (
            enforce_category_verification,
        )

        challenge = enforce_category_verification(payload)
        if challenge and challenge.identity_registry:
            payload["identity_registry"] = challenge.identity_registry

    payload = apply_tenant_context_to_payload(
        payload=payload,
        require_tenant=True,
    )

    ai_profile_override = None
    chat_category = payload.get("chat_category")
    session_user = get_authenticated_session_user()
    if is_internal_session_user(session_user):
        internal_behavior = resolve_behavior_for_internal_user(session_user)
        if not internal_behavior and not is_system_manager_session_user(session_user):
            frappe.throw(
                "No active Nexus User Profile Assignment exists for the logged-in user. "
                "Please ask an administrator to assign an AI Agent Profile."
            )
        if internal_behavior:
            ai_profile_override = frappe.get_doc(
                "Nexus AI Agent Profile", internal_behavior.profile_name
            )
    elif chat_category:
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
        cat_behavior = resolve_behavior_from_chat_category(chat_category, identity_type, is_authenticated)
        if cat_behavior and cat_behavior.profile_name:
            payload["identity_type"] = identity_type
            payload["identity_registry"] = payload.get("identity_registry") or resolve_identity_registry_name(payload)
            safeguard_categories = resolve_identity_safeguard_access_categories(payload)
            if safeguard_categories is not None:
                payload["identity_safeguard_access_categories"] = safeguard_categories
            ai_profile_override = frappe.get_doc(
                "Nexus AI Agent Profile", cat_behavior.profile_name
            )
        else:
            frappe.throw(
                "No active AI Agent Profile route exists for this chat category "
                f"and identity type ({identity_type})."
            )

    if ai_profile_override and ai_profile_override.get("agent"):
        payload["agent"] = ai_profile_override.agent

    agent = assign_agent(payload)

    if not agent:
        frappe.throw("No approved idle AI agent available for live chat.")

    conversation = create_conversation(
        payload=payload,
        assigned_agent=agent,
        ai_profile_override=ai_profile_override,
    )

    conversation = update_conversation_assignment(conversation, agent)

    # Store the visitor's first message immediately
    sender_type = "Visitor" if payload.get("user_type", "Guest") == "Guest" else "User"
    add_message(
        conversation=conversation,
        sender_type=sender_type,
        message=message,
        response_mode="chat",
    )

    # Enqueue AI processing — returns immediately to the client
    _enqueue_ai_response(conversation.conversation_id, payload)

    return {
        "status": "processing",
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,
        "agent": agent.name,
        "agent_code": agent.agent_code,
        "agent_name": agent.display_name or agent.agent_name,
    }


def continue_live_chat(conversation_id, payload):
    payload = payload or {}
    payload = apply_session_user_context(payload)

    conversation = get_conversation(conversation_id)

    if not conversation:
        frappe.throw("Conversation not found.")

    if not conversation.assigned_agent:
        frappe.throw("Conversation has no assigned agent.")

    message = payload.get("message")

    if not message:
        frappe.throw("Message is required.")

    payload["message"] = message

    payload = enrich_payload_from_conversation(
        payload=payload,
        conversation=conversation,
    )

    # Store the visitor's message immediately
    sender_type = "Visitor" if payload.get("user_type", "Guest") == "Guest" else "User"
    add_message(
        conversation=conversation,
        sender_type=sender_type,
        message=message,
        response_mode="chat",
    )

    # Enqueue AI processing — returns immediately to the client
    _enqueue_ai_response(conversation.conversation_id, payload)

    return {
        "status": "processing",
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,
    }


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

        agent = frappe.get_doc("Nexus Live Agent", conversation.assigned_agent)
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

        user_requested_human = bool(core_response.get("user_requested_human"))
        if user_requested_human and escalation_enabled:
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
            "conversation": conversation.name,
            "agent": agent.name,
            "agent_code": agent.agent_code,
            "agent_name": agent.display_name or agent.agent_name,

            "message": answer,
            "answer": answer,
            "confidence": confidence,
            "sources": sources,

            "escalated": bool(escalation_created),
            "escalation": escalation_created.name if escalation_created else None,

            "confidence_threshold": threshold,
            "fallback_used": 1 if core_response.get("fallback_used") else 0,

            "tenant": payload.get("tenant"),
            "channel": payload.get("channel"),
            "resolved_tenant_context": resolved_context,
        })

    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Live Chat Background Processing Failed")
        publish_chat_error(conversation_id, "An error occurred processing your message.")
