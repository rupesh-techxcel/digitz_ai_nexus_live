import json
import frappe

from digitz_ai_nexus_live.services.live_qa_service import ask_live_question
from digitz_ai_nexus_live.services.live_chat_service import (
    start_live_chat,
    continue_live_chat,
)
from digitz_ai_nexus_live.services.conversation_service import (
    get_conversation,
    get_conversation_messages,
)
from digitz_ai_nexus_live.services.identity_resolver import resolve_identity_type


def parse_payload(payload=None):
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except Exception:
            frappe.throw("Invalid JSON payload.")

    return payload or {}


@frappe.whitelist(allow_guest=True)
def get_channel_categories(channel=None, visitor_email=None, email=None):
    """
    Return chat categories the current visitor may actually use.

    Two filters applied:
    1. requires_authentication — hide auth-only categories from guests
    2. Route existence — only show categories that have an active route
       configured for the visitor's resolved identity type. A category with
       no route would cause a hard error when selected.
    """
    if not channel:
        frappe.throw("Channel is required.")

    is_authenticated = frappe.session.user not in ("Guest", None, "")

    identity_type = resolve_identity_type({
        "user_type": "Guest" if not is_authenticated else "Website User",
        "visitor_email": visitor_email or email,
    })

    auth_filters = {"channel": channel, "enabled": 1}
    if not is_authenticated:
        auth_filters["requires_authentication"] = 0

    candidates = frappe.get_all(
        "Nexus Chat Category",
        filters=auth_filters,
        fields=[
            "name",
            "category_code",
            "category_label",
            "display_order",
            "description",
            "identity_verification_mode",
            "allow_public_fallback",
        ],
        order_by="display_order asc",
    )

    if not candidates:
        return {"channel": channel, "is_authenticated": is_authenticated, "categories": []}

    candidate_codes = [c.category_code for c in candidates]

    routed_codes = set(frappe.get_all(
        "Nexus Category Identity Route",
        filters={
            "channel": channel,
            "chat_category": ["in", candidate_codes],
            "identity_type": identity_type,
            "enabled": 1,
        },
        pluck="chat_category",
    ))

    verification_codes = {
        c.category_code
        for c in candidates
        if c.identity_verification_mode in ("Email OTP", "Registered Email OTP")
    }

    if verification_codes:
        routed_codes.update(frappe.get_all(
            "Nexus Category Identity Route",
            filters={
                "channel": channel,
                "chat_category": ["in", list(verification_codes)],
                "enabled": 1,
            },
            pluck="chat_category",
        ))

    categories = [c for c in candidates if c.category_code in routed_codes]

    return {
        "channel": channel,
        "is_authenticated": is_authenticated,
        "identity_type": identity_type,
        "categories": categories,
    }


@frappe.whitelist(allow_guest=True)
def ask_question(payload=None):
    """Public / internal Q And A API endpoint."""
    payload = parse_payload(payload)
    return ask_live_question(payload)


@frappe.whitelist(allow_guest=True)
def start_chat(payload=None):
    """
    Start a new live chat conversation.
    Returns immediately with conversation_id and status=processing.
    The AI response is pushed via frappe.realtime event "nexus_chat_response".
    """
    payload = parse_payload(payload)
    return start_live_chat(payload)


@frappe.whitelist(allow_guest=True)
def send_chat_message(conversation_id=None, payload=None):
    """
    Send a message in an existing live chat conversation.
    Returns immediately with status=processing.
    The AI response is pushed via frappe.realtime event "nexus_chat_response".
    """
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    payload = parse_payload(payload)

    return continue_live_chat(
        conversation_id=conversation_id,
        payload=payload,
    )


@frappe.whitelist()
def get_active_conversations(limit=50):
    """
    Return active conversations for the Live Console.
    Desk users only.
    """
    conversations = frappe.get_all(
        "Nexus Live Conversation",
        filters={"status": ["in", ["Open", "Responding", "Escalated"]]},
        fields=[
            "name",
            "conversation_id",
            "conversation_type",
            "status",
            "escalation_status",
            "assigned_agent",
            "assigned_agent_type",
            "channel",
            "chat_category",
            "resolved_identity_type",
            "user_type",
            "visitor_name",
            "visitor_email",
            "last_message",
            "last_response",
            "confidence",
            "started_on",
        ],
        order_by="started_on desc",
        limit_page_length=int(limit),
    )

    return {"conversations": conversations}


@frappe.whitelist()
def get_conversation_detail(conversation_id=None):
    """
    Return full conversation metadata + messages for the Live Console.
    Desk users only.
    """
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    conversation = get_conversation(conversation_id)

    if not conversation:
        frappe.throw("Conversation not found.")

    messages = get_conversation_messages(conversation=conversation, limit=100)

    return {
        "conversation": {
            "name": conversation.name,
            "conversation_id": conversation.conversation_id,
            "status": conversation.status,
            "escalation_status": conversation.escalation_status,
            "assigned_agent": conversation.assigned_agent,
            "channel": conversation.channel,
            "chat_category": conversation.chat_category,
            "resolved_identity_type": conversation.resolved_identity_type,
            "user_type": conversation.user_type,
            "visitor_name": conversation.visitor_name,
            "visitor_email": conversation.visitor_email,
            "started_on": str(conversation.started_on) if conversation.started_on else None,
        },
        "messages": [
            {
                "name": m.name,
                "sender_type": m.sender_type,
                "sender_agent": m.sender_agent,
                "message": m.message,
                "confidence": m.confidence,
                "message_time": str(m.message_time) if m.message_time else None,
            }
            for m in messages
        ],
    }
