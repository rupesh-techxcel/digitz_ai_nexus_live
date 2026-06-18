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


@frappe.whitelist()
def get_available_categories_for_tenant(tenant=None):
    """
    Return all enabled chat categories for internal console use.
    Desk agents see every enabled category regardless of channel or identity type.
    """
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"enabled": 1},
        fields=["name", "category_code", "category_label", "description", "display_order"],
        order_by="display_order asc",
    )
    return {"categories": categories}


@frappe.whitelist(allow_guest=True)
def get_channel_categories(channel=None, visitor_email=None, email=None):
    """
    Return chat categories the current visitor may actually use.

    Two filters applied:
    1. visibility — only External and Both categories appear in the public widget
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

    auth_filters = {"channel": channel, "enabled": 1, "visibility": ["in", ["External", "Both"]]}

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
def get_widget_tenant():
    """
    Minimal guest-accessible endpoint so the public chat widget can resolve
    the active tenant without requiring a login.
    Returns only the first enabled tenant name.
    """
    tenant = frappe.db.get_value("Nexus Tenant", {"disabled": 0}, "name", order_by="creation asc")
    return {"tenant": {"name": tenant} if tenant else None}


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


def _get_human_assignment(user):
    """Return active assignment if user can handle escalations but is not System Manager."""
    if not user or user == "Guest":
        return None

    name = frappe.db.get_value(
        "Nexus User Profile Assignment",
        {"user": user, "active": 1, "can_handle_escalations": 1},
        "name",
    )
    if not name:
        return None

    return frappe.get_doc("Nexus User Profile Assignment", name)


def _is_human_agent_only():
    """True when caller has an escalation-enabled assignment but is NOT System Manager."""
    user = frappe.session.user
    if user in ("Guest", None):
        return False

    if "System Manager" in frappe.get_roles(user):
        return False

    return bool(_get_human_assignment(user))


@frappe.whitelist()
def get_active_conversations(limit=50, tenant=None):
    """
    Return conversations for the Live Console.
    - System Manager: all conversations including recently Closed ones
    - Human agent (can_handle_escalations): all active external conversations
    Filtered to channels belonging to the given tenant when provided.
    """
    base_fields = [
        "name", "conversation_id", "conversation_type",
        "status", "escalation_status", "escalated_at", "human_agent",
        "assigned_agent", "assigned_agent_type",
        "channel", "chat_category", "resolved_identity_type",
        "user_type", "visitor_name", "visitor_email",
        "last_message", "last_response", "confidence", "started_on",
    ]

    tenant_channel_filter = {}
    if tenant:
        tenant_channels = frappe.get_all(
            "Nexus Live Channel",
            filters={"tenant": tenant},
            pluck="name",
        )
        tenant_channel_filter = {"channel": ["in", tenant_channels]} if tenant_channels else {"channel": ["in", ["__none__"]]}

    if _is_human_agent_only():
        user = frappe.session.user
        assignment = _get_human_assignment(user)
        assigned_cats = []
        if assignment:
            assigned_cats = [row.chat_category for row in (assignment.escalation_categories or [])]

        # Show all external conversations including recently closed ones
        filters = {
            "status": ["in", ["Open", "Responding", "Escalated", "Waiting", "Closed"]],
            "user_type": ["!=", "Desk User"],
        }
        filters.update(tenant_channel_filter)

        conversations = frappe.get_all(
            "Nexus Live Conversation",
            filters=filters,
            fields=base_fields,
            order_by="started_on desc",
            limit_page_length=int(limit),
        )
        _attach_category_labels(conversations)
        nickname = frappe.db.get_value("User", user, "full_name") or user
        return {
            "conversations": conversations,
            "mode": "agent",
            "agent": user,
            "agent_nickname": nickname,
            "assigned_categories": assigned_cats,
        }

    filters = {
        "status": ["in", ["Open", "Responding", "Escalated", "Waiting", "Closed"]],
        "user_type": ["!=", "Desk User"],
    }
    filters.update(tenant_channel_filter)

    conversations = frappe.get_all(
        "Nexus Live Conversation",
        filters=filters,
        fields=base_fields,
        order_by="started_on desc",
        limit_page_length=int(limit),
    )
    _attach_category_labels(conversations)
    return {"conversations": conversations, "mode": "admin"}


@frappe.whitelist(allow_guest=True)
def get_conversation_detail(conversation_id=None):
    """
    Return full conversation metadata + messages.
    Called by both the Live Console (desk) and the website widget (guest resume).
    """
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    conversation = get_conversation(conversation_id)

    if not conversation:
        frappe.throw("Conversation not found.")

    messages = get_conversation_messages(conversation=conversation, limit=100)

    # Resolve human agent nickname if set
    human_agent_nickname = None
    if conversation.human_agent:
        human_agent_nickname = frappe.db.get_value(
            "User", conversation.human_agent, "full_name"
        ) or conversation.human_agent

    return {
        "conversation": {
            "name": conversation.name,
            "conversation_id": conversation.conversation_id,
            "status": conversation.status,
            "escalation_status": conversation.escalation_status,
            "escalated_at": str(conversation.escalated_at) if conversation.escalated_at else None,
            "human_agent": conversation.human_agent,
            "human_agent_nickname": human_agent_nickname,
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


def _attach_category_labels(conversations):
    """Add category_label to each conversation dict via a single batch query."""
    cat_names = list({c.get("chat_category") for c in conversations if c.get("chat_category")})
    if not cat_names:
        return
    rows = frappe.get_all(
        "Nexus Chat Category",
        filters={"name": ["in", cat_names]},
        fields=["name", "category_label"],
    )
    label_map = {r["name"]: r["category_label"] for r in rows}
    for c in conversations:
        c["category_label"] = label_map.get(c.get("chat_category"), "")
