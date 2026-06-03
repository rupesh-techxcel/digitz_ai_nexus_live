import json
import frappe
from frappe.utils import now_datetime
from digitz_ai_nexus_live.services.agent_service import get_ai_profile


def generate_conversation_id():
    return frappe.generate_hash(length=12).upper()


def get_conversation(conversation_id_or_name):
    if not conversation_id_or_name:
        return None

    if frappe.db.exists("Nexus Live Conversation", conversation_id_or_name):
        return frappe.get_doc("Nexus Live Conversation", conversation_id_or_name)

    name = frappe.db.get_value(
        "Nexus Live Conversation",
        {"conversation_id": conversation_id_or_name},
        "name",
    )

    if name:
        return frappe.get_doc("Nexus Live Conversation", name)

    return None


def create_conversation(payload, assigned_agent=None, ai_profile_override=None):
    payload = payload or {}

    conversation = frappe.new_doc("Nexus Live Conversation")
    conversation.conversation_id = payload.get("conversation_id") or generate_conversation_id()
    conversation.conversation_type = payload.get("conversation_type") or "Chat"
    conversation.channel = payload.get("channel")
    conversation.visitor_name = payload.get("visitor_name")
    conversation.visitor_email = payload.get("visitor_email")
    conversation.visitor_phone = payload.get("visitor_phone")
    conversation.user_type = payload.get("user_type") or "Guest"
    conversation.intent = payload.get("intent")
    conversation.status = "Open"
    conversation.escalation_status = "None"
    conversation.started_on = now_datetime()

    if assigned_agent:
        conversation.assigned_agent = assigned_agent.name
        conversation.assigned_agent_type = assigned_agent.agent_type

        if getattr(assigned_agent, "agent_type", None) == "AI":
            profile = ai_profile_override or get_ai_profile(assigned_agent)
            if profile:
                conversation.assigned_ai_agent_profile = profile.name
                conversation.ai_profile_snapshot_json = json.dumps({
                    "name": profile.name,
                    "agent": profile.agent,
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
                })

    conversation.insert(ignore_permissions=True)
    return conversation


def update_conversation_assignment(conversation, agent):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc or not agent:
        return None

    conversation_doc.assigned_agent = agent.name
    conversation_doc.assigned_agent_type = agent.agent_type
    conversation_doc.status = "Responding"
    conversation_doc.save(ignore_permissions=True)

    return conversation_doc


def add_message(
    conversation,
    sender_type,
    message,
    sender_agent=None,
    response_mode=None,
    confidence=None,
    sources=None,
    retrieval_debug=None,
):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        frappe.throw("Conversation not found.")

    msg = frappe.new_doc("Nexus Live Message")
    msg.conversation = conversation_doc.name
    msg.sender_type = sender_type
    msg.sender_agent = sender_agent
    msg.message = message
    msg.response_mode = response_mode
    msg.confidence = confidence
    msg.sources_json = json.dumps(sources or [], indent=2)
    msg.retrieval_debug_json = json.dumps(retrieval_debug or {}, indent=2)
    msg.message_time = now_datetime()
    msg.insert(ignore_permissions=True)

    conversation_doc.last_message = message if sender_type in ("Visitor", "User") else conversation_doc.last_message
    conversation_doc.last_response = message if sender_type in ("AI Agent", "Human Agent") else conversation_doc.last_response

    if confidence is not None:
        conversation_doc.confidence = confidence

    conversation_doc.save(ignore_permissions=True)

    return msg


def add_participant(conversation, participant_type, agent=None, user=None):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    participant = frappe.new_doc("Nexus Conversation Participant")
    participant.conversation = conversation_doc.name
    participant.participant_type = participant_type
    participant.agent = agent
    participant.user = user
    participant.joined_on = now_datetime()
    participant.is_active = 1
    participant.insert(ignore_permissions=True)

    return participant


def set_conversation_status(conversation, status):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return None

    conversation_doc.status = status

    if status == "Closed":
        conversation_doc.closed_on = now_datetime()

    conversation_doc.save(ignore_permissions=True)
    return conversation_doc


def mark_escalated(conversation):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return None

    conversation_doc.status = "Escalated"
    conversation_doc.escalation_status = "Pending"
    conversation_doc.save(ignore_permissions=True)

    return conversation_doc


def close_conversation(conversation):
    return set_conversation_status(conversation, "Closed")


def get_conversation_messages(conversation, limit=20):
    conversation_doc = conversation if hasattr(conversation, "doctype") else get_conversation(conversation)

    if not conversation_doc:
        return []

    return frappe.get_all(
        "Nexus Live Message",
        filters={"conversation": conversation_doc.name},
        fields=[
            "name",
            "sender_type",
            "sender_agent",
            "message",
            "response_mode",
            "confidence",
            "message_time",
        ],
        order_by="message_time asc",
        limit_page_length=limit,
    )