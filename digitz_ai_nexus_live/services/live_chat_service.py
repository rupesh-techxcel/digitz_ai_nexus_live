import frappe

from digitz_ai_nexus_live.services.agent_router import assign_agent
from digitz_ai_nexus_live.services.agent_service import (
    get_ai_profile,
    set_agent_status,
)
from digitz_ai_nexus_live.services.conversation_service import (
    create_conversation,
    get_conversation,
    update_conversation_assignment,
    add_message,
    get_conversation_messages,
)
from digitz_ai_nexus_live.services.escalation_service import (
    should_escalate,
    create_escalation,
)
from digitz_ai_nexus_live.services.conversation_context_service import (
    build_chat_continuity_payload,
)

from digitz_ai_nexus.services.answer_service import answer_query


MAX_HISTORY_MESSAGES = 20
CHAT_RESPONSE_SENTENCE_LIMIT = 6


def build_chat_history(conversation):
    """
    Build simplified chat history for contextual continuity and prompt awareness.
    """
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


def build_core_chat_payload(payload, conversation, agent, profile):
    """
    Build payload for Nexus Core answer service.

    Chat is continuity-aware.
    Q&A should remain stateless and must not use this flow.
    """
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

    user_context = payload.get("user") or {
        "roles": payload.get("roles") or ["Guest"]
    }

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

        "conversation_id": conversation.conversation_id,
        "chat_history": chat_history,
        "conversation_context": continuity.get("conversation_context"),
        "context_message_count": continuity.get("context_message_count"),
        "is_follow_up": continuity.get("is_follow_up"),

        "user": user_context,

        "agent_code": agent.agent_code,
        "agent_role": agent.agent_role,
        "agent_behavior_prompt": profile.behavior_prompt if profile else None,
        "agent_tone": profile.tone if profile else None,
        "agent_response_style": profile.response_style if profile else None,
        "agent_fallback_message": profile.fallback_message if profile else None,
        "agent_do_not_answer_rules": profile.do_not_answer_rules if profile else None,
    }


def start_live_chat(payload):
    """
    Start a brand-new live chat conversation.
    """
    payload = payload or {}

    message = payload.get("message")

    if not message:
        frappe.throw("Message is required.")

    payload["conversation_type"] = "Chat"

    agent = assign_agent(payload)

    if not agent:
        frappe.throw("No approved idle AI agent available for live chat.")

    conversation = create_conversation(
        payload=payload,
        assigned_agent=agent,
    )

    conversation = update_conversation_assignment(
        conversation,
        agent,
    )

    return continue_live_chat(
        conversation_id=conversation.conversation_id,
        payload=payload,
    )


def continue_live_chat(conversation_id, payload):
    """
    Continue existing live chat conversation.
    """
    payload = payload or {}

    conversation = get_conversation(conversation_id)

    if not conversation:
        frappe.throw("Conversation not found.")

    if not conversation.assigned_agent:
        frappe.throw("Conversation has no assigned agent.")

    message = payload.get("message")

    if not message:
        frappe.throw("Message is required.")

    agent = frappe.get_doc(
        "Nexus Live Agent",
        conversation.assigned_agent,
    )

    profile = get_ai_profile(agent)

    set_agent_status(
        agent,
        "Responding",
        conversation=conversation.name,
        remarks="AI agent responding in live chat.",
    )

    add_message(
        conversation=conversation,
        sender_type="Visitor" if payload.get("user_type", "Guest") == "Guest" else "User",
        message=message,
        response_mode="chat",
    )

    core_payload = build_core_chat_payload(
        payload=payload,
        conversation=conversation,
        agent=agent,
        profile=profile,
    )

    try:
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

        raise

    answer = core_response.get("answer") if isinstance(core_response, dict) else None
    confidence = core_response.get("confidence") if isinstance(core_response, dict) else None
    sources = core_response.get("sources") if isinstance(core_response, dict) else []
    retrieval_debug = core_response.get("retrieval_debug") if isinstance(core_response, dict) else {}

    if not answer:
        answer = (
            profile.fallback_message
            if profile and profile.fallback_message
            else "I do not have enough approved knowledge to answer this."
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

    no_knowledge = answer.strip() == "I do not have enough approved knowledge to answer this."

    threshold = (
        profile.confidence_threshold
        if profile and profile.confidence_threshold is not None
        else 0.65
    )

    escalation_enabled = bool(profile.escalation_enabled) if profile else True

    escalation_created = None

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
            remarks="Auto escalation triggered from Live Chat.",
        )

    return {
        "status": "success",
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,
        "agent": agent.name,
        "agent_code": agent.agent_code,
        "agent_name": agent.display_name or agent.agent_name,
        "message": answer,
        "confidence": confidence,
        "sources": sources,
        "retrieval_debug": retrieval_debug,
        "escalated": bool(escalation_created),
        "escalation": escalation_created.name if escalation_created else None,
    }