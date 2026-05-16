import frappe

from digitz_ai_nexus_live.services.agent_router import assign_agent
from digitz_ai_nexus_live.services.agent_service import (
    get_agent_behavior,
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
from digitz_ai_nexus.services.tenant_context import apply_tenant_context_to_payload


MAX_HISTORY_MESSAGES = 20
CHAT_RESPONSE_SENTENCE_LIMIT = 6
DEFAULT_FALLBACK_ANSWER = "I do not have enough approved knowledge to answer this."


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

    return apply_tenant_context_to_payload(
        payload=payload,
        require_tenant=True,
    )


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

        "top_k": payload.get("top_k"),
        "channel": payload.get("channel"),

        "conversation_id": conversation.conversation_id,
        "chat_history": chat_history,
        "conversation_context": continuity.get("conversation_context"),
        "context_message_count": continuity.get("context_message_count"),
        "is_follow_up": continuity.get("is_follow_up"),

        "user": user_context,

        "agent_code": agent.agent_code,
        "agent_role": agent.agent_role,

        "agent_behavior_prompt": behavior.behavior_prompt if behavior else None,
        "agent_tone": behavior.tone if behavior else None,
        "agent_response_style": behavior.response_style if behavior else None,
        "agent_fallback_message": behavior.fallback_message if behavior else None,
        "agent_do_not_answer_rules": behavior.do_not_answer_rules if behavior else None,

        "behaviour": behavior.behaviour if behavior else None,
        "behaviour_code": behavior.behaviour_code if behavior else None,
        "behaviour_name": behavior.behaviour_name if behavior else None,
        "behaviour_source": behavior.source if behavior else None,
        "uses_assigned_behaviour": behavior.uses_assigned_behaviour if behavior else 0,

        "_resolved_tenant_context": payload.get("_resolved_tenant_context"),
    }


def start_live_chat(payload):
    payload = payload or {}

    message = payload.get("message")

    if not message:
        frappe.throw("Message is required.")

    payload["message"] = message
    payload["conversation_type"] = "Chat"

    payload = apply_tenant_context_to_payload(
        payload=payload,
        require_tenant=True,
    )

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
    payload = payload or {}

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

    agent = frappe.get_doc(
        "Nexus Live Agent",
        conversation.assigned_agent,
    )

    behavior = get_agent_behavior(agent)

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
        behavior=behavior,
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

    no_knowledge = (
        answer.strip() == DEFAULT_FALLBACK_ANSWER
        or answer.strip() == fallback_message
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

    resolved_context = payload.get("_resolved_tenant_context") or {}

    return {
        "status": "success",
        "conversation": conversation.name,
        "conversation_id": conversation.conversation_id,
        "agent": agent.name,
        "agent_code": agent.agent_code,
        "agent_name": agent.display_name or agent.agent_name,

        "message": answer,
        "answer": answer,
        "confidence": confidence,
        "sources": sources,
        "retrieval_debug": retrieval_debug,

        "escalated": bool(escalation_created),
        "escalation": escalation_created.name if escalation_created else None,

        "behaviour": behavior.behaviour if behavior else None,
        "behaviour_code": behavior.behaviour_code if behavior else None,
        "behaviour_name": behavior.behaviour_name if behavior else None,
        "behaviour_designation": behavior.behaviour_designation if behavior else None,
        "behaviour_source": behavior.source if behavior else None,
        "uses_assigned_behaviour": behavior.uses_assigned_behaviour if behavior else 0,

        "confidence_threshold": threshold,
        "confidence_threshold_source": behavior.confidence_threshold_source if behavior else None,
        "fallback_used": 1 if no_knowledge else 0,

        "tenant": payload.get("tenant"),
        "business_unit": payload.get("business_unit"),
        "project": payload.get("project"),
        "channel": payload.get("channel"),
        "context": payload.get("context"),
        "resolved_tenant_context": resolved_context,
        "tenant_context_applied": 1 if resolved_context else 0,
    }