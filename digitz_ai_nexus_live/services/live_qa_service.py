import frappe

from digitz_ai_nexus_live.services.agent_router import assign_agent
from digitz_ai_nexus_live.services.profile_resolver import (
    get_authenticated_session_user,
    get_session_user_type,
    get_user_context,
    is_internal_session_user,
    is_system_manager_session_user,
    resolve_behavior_for_internal_user,
    resolve_behavior_from_chat_category,
)
from digitz_ai_nexus_live.services.identity_resolver import (
    resolve_identity_safeguard_access_categories,
    resolve_identity_type,
)
from digitz_ai_nexus_live.services.conversation_service import (
    create_conversation,
    update_conversation_assignment,
    add_message,
)
from digitz_ai_nexus_live.services.escalation_service import (
    should_escalate,
    create_escalation,
)

from digitz_ai_nexus.services.answer_service import answer_query
from digitz_ai_nexus.services.tenant_context import apply_tenant_context_to_payload
from digitz_ai_nexus.engine.access_resolver import resolve_allowed_policies


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


def build_core_payload(payload, agent=None, profile=None, is_public=False):
    """
    Build payload for Nexus Core answer service.
    Nexus Live should not perform retrieval directly.

    Q&A remains direct and stateless.
    Tenant/business/context defaults are already resolved before this method.
    """
    payload = payload or {}

    user_context = payload.get("user") or {
        "roles": payload.get("roles") or ["Guest"]
    }

    # Resolve profile before access policies; the selected profile is the access authority.
    resolved_behavior = None
    chat_category = payload.get("chat_category")

    session_user = get_authenticated_session_user()
    if is_internal_session_user(session_user):
        resolved_behavior = resolve_behavior_for_internal_user(session_user)
        if not resolved_behavior and not is_system_manager_session_user(session_user):
            frappe.throw(
                "No active Nexus User Profile Assignment exists for the logged-in user. "
                "Please ask an administrator to assign an AI Agent Profile."
            )
    elif chat_category:
        is_authenticated = payload.get("user_type", "Guest") != "Guest"
        identity_type = resolve_identity_type(payload)
        resolved_behavior = resolve_behavior_from_chat_category(
            chat_category, identity_type, is_authenticated
        )
    elif profile:
        from digitz_ai_nexus_live.services.profile_resolver import _build_behavior_dict
        resolved_behavior = _build_behavior_dict(profile, source="Nexus AI Agent Profile")

    ai_profile = {}
    if resolved_behavior:
        ai_profile = {
            "name": resolved_behavior.profile_name or "",
            "behavior_prompt": resolved_behavior.behavior_prompt,
            "tone": resolved_behavior.tone,
            "response_style": resolved_behavior.response_style,
            "welcome_message": resolved_behavior.welcome_message,
            "fallback_message": resolved_behavior.fallback_message,
            "do_not_answer_rules": resolved_behavior.do_not_answer_rules,
            "confidence_threshold": resolved_behavior.confidence_threshold,
            "escalation_enabled": resolved_behavior.escalation_enabled,
            "escalation_policy": resolved_behavior.escalation_policy,
            "memory_mode": resolved_behavior.memory_mode,
            "default_response_mode": "qa",
            "category_code": resolved_behavior.category_code,
            "identity_type": resolved_behavior.identity_type,
        }

    resolved_identity_type = ai_profile.get("identity_type") or payload.get("identity_type")
    force_public_only = bool(
        is_public
        and not ai_profile.get("name")
    )

    access_resolution = resolve_allowed_policies({
        "channel": payload.get("channel"),
        "user": user_context,
        "force_public_only": force_public_only,
        "identity_type": resolved_identity_type,
        "identity_safeguard_access_categories": (
            payload.get("identity_safeguard_access_categories")
            if "identity_safeguard_access_categories" in payload
            else resolve_identity_safeguard_access_categories(payload)
        ),
        "ai_profile": ai_profile,
    })

    core_payload = {
        "query": payload.get("query") or payload.get("question"),
        "response_mode": "qa",

        "tenant": payload.get("tenant"),
        "business_unit": payload.get("business_unit"),
        "project": payload.get("project"),
        "project_scope_mode": payload.get("project_scope_mode") or "with_general",

        "caller_system": "Nexus Live",
        "use_case": "Live Q And A",

        "context": payload.get("context"),
        "sub_context": payload.get("sub_context"),
        "entity_type": payload.get("entity_type"),
        "entity": payload.get("entity"),
        "topic": payload.get("topic"),

        "top_k": payload.get("top_k"),

        "channel": payload.get("channel"),
        "user": user_context,
        "force_public_only": force_public_only,
        "allowed_access_policies": access_resolution["allowed_access_policies"],

        "ai_profile": ai_profile,

        "_resolved_tenant_context": payload.get("_resolved_tenant_context"),
    }

    if agent:
        core_payload["agent_code"] = agent.agent_code
        core_payload["agent_role"] = agent.agent_role

    return core_payload


def ask_live_question(payload):
    """
    Main Nexus Live Q&A entry point.

    Flow:
    Question
    -> apply tenant/user/ecosystem context defaults
    -> detect whether channel is agent-based
    -> optionally assign AI agent for agent-based Q&A channels
    -> create conversation
    -> call Nexus Core
    -> store response
    -> optionally escalate if agent-based
    -> return response

    Note:
    Normal Q&A remains direct and does not require an agent.
    Agent-based Q&A is preserved only for channels explicitly configured that way.
    """
    payload = payload or {}

    question = payload.get("query") or payload.get("question")

    if not question:
        frappe.throw("Question is required.")

    payload["query"] = question
    payload["conversation_type"] = "Q&A"
    payload = apply_session_user_context(payload)

    payload = apply_tenant_context_to_payload(
        payload=payload,
        require_tenant=True,
    )

    channel_name = payload.get("channel")
    channel = None

    if channel_name and frappe.db.exists("Nexus Live Channel", channel_name):
        channel = frappe.get_doc("Nexus Live Channel", channel_name)

    agent_based = bool(getattr(channel, "agent_based", 0)) if channel else False

    agent = None
    profile = None

    if agent_based:
        agent = assign_agent(payload)

        if not agent:
            frappe.throw("No approved idle AI agent available for Q And A.")

        profile = agent  # The profile IS the agent

    conversation = create_conversation(
        payload,
        assigned_agent=agent if agent_based else None,
    )

    if agent_based and agent:
        conversation = update_conversation_assignment(conversation, agent)

    add_message(
        conversation=conversation,
        sender_type="Visitor" if payload.get("user_type", "Guest") == "Guest" else "User",
        message=question,
        response_mode="qa",
    )

    is_public = payload.get("user_type", "Guest") == "Guest"

    core_payload = build_core_payload(
        payload=payload,
        agent=agent if agent_based else None,
        profile=profile if agent_based else None,
        is_public=is_public,
    )

    try:
        core_response = answer_query(core_payload)
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Nexus Live Q And A Core Answer Failed",
        )
        raise

    answer = core_response.get("answer") if isinstance(core_response, dict) else None
    confidence = core_response.get("confidence") if isinstance(core_response, dict) else None
    sources = core_response.get("sources") if isinstance(core_response, dict) else []
    retrieval_debug = core_response.get("retrieval_debug") if isinstance(core_response, dict) else {}

    if not answer:
        answer = (
            profile.fallback_message
            if profile and profile.fallback_message
            else DEFAULT_FALLBACK_ANSWER
        )

    add_message(
        conversation=conversation,
        sender_type="AI Agent" if agent_based else "System",
        sender_agent=agent.name if agent else None,
        message=answer,
        response_mode="qa",
        confidence=confidence,
        sources=sources,
        retrieval_debug=retrieval_debug,
    )

    no_knowledge = answer.strip() == DEFAULT_FALLBACK_ANSWER

    escalation_created = None

    if agent_based and agent:
        threshold = (
            profile.confidence_threshold
            if profile and profile.confidence_threshold is not None
            else 0.65
        )

        escalation_enabled = bool(profile.escalation_enabled) if profile else True

        if should_escalate(
            confidence=confidence,
            no_knowledge=no_knowledge,
            user_requested_human=payload.get("user_requested_human") or False,
            escalation_enabled=escalation_enabled,
            threshold=threshold,
        ):
            escalation_created = create_escalation(
                conversation=conversation,
                reason="Low Confidence" if not no_knowledge else "No Approved Knowledge",
                from_agent=agent,
                confidence=confidence,
                remarks="Auto escalation triggered from agent-based Live Q And A.",
            )

    resolved_context = payload.get("_resolved_tenant_context") or {}

    return {
        "status": "success",
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,

        "agent_based": agent_based,
        "agent": agent.name if agent else None,
        "agent_code": agent.agent_code if agent else None,
        "agent_name": (agent.display_name or agent.agent_name) if agent else None,

        "answer": answer,
        "confidence": confidence,
        "sources": sources,
        "retrieval_debug": retrieval_debug,

        "escalated": bool(escalation_created),
        "escalation": escalation_created.name if escalation_created else None,

        "tenant": payload.get("tenant"),
        "business_unit": payload.get("business_unit"),
        "project": payload.get("project"),
        "channel": payload.get("channel"),
        "context": payload.get("context"),
        "resolved_tenant_context": resolved_context,
        "tenant_context_applied": 1 if resolved_context else 0,
    }
