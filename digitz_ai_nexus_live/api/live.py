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
from digitz_ai_nexus_live.services.rate_limit import (
    check_rate_limit,
    get_caller_ip,
    validate_widget_origin,
)


def parse_payload(payload=None):
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except Exception:
            frappe.throw("Invalid JSON payload.")

    return payload or {}


def _resolve_widget_for_api_call(widget_code):
    """Returns widget row or None (absent = trusted caller). Throws on invalid contract."""
    if not widget_code:
        return None
    from digitz_ai_nexus_live.nexus_live_channels.doctype.nexus_website_widget.nexus_website_widget import (
        get_widget_for_api_call,
    )
    widget = get_widget_for_api_call(widget_code)
    if not widget:
        frappe.throw("Widget contract is not valid or has been suspended.")
    return widget


def get_category_faq_questions(category_name):
    """Return enabled public-safe FAQ quick questions for a chat category."""
    if not category_name:
        return []

    rows = frappe.get_all(
        "Nexus Chat Category FAQ",
        filters={
            "parent": category_name,
            "parenttype": "Nexus Chat Category",
            "enabled": 1,
        },
        fields=["name", "question", "display_order"],
        order_by="display_order asc, idx asc",
    )
    return [{"name": row.name, "question": row.question} for row in rows]


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
def get_channel_categories(channel=None, tenant=None, visitor_email=None, email=None, widget_code=None):
    """
    Return chat categories the current visitor may actually use.

    Two filters applied:
    1. visibility — only External and Both categories appear in the public widget
    2. Route existence — only show categories that have an active route
       configured for the visitor's resolved identity type. A category with
       no route would cause a hard error when selected.
    """
    widget = _resolve_widget_for_api_call(widget_code)
    if widget and not widget.knowledge_delivery_enabled:
        return {
            "channel": channel,
            "tenant": tenant,
            "categories": [],
            "knowledge_delivery_enabled": False,
        }

    is_authenticated = frappe.session.user not in ("Guest", None, "")

    identity_type = resolve_identity_type({
        "user_type": "Guest" if not is_authenticated else "Website User",
        "visitor_email": visitor_email or email,
    })

    channel_filters = {"enabled": 1, "channel_type": "Website Chat"}
    if tenant:
        channel_filters["tenant"] = tenant
    if channel:
        channel_filters["name"] = channel

    channel_names = frappe.get_all(
        "Nexus Live Channel",
        filters=channel_filters,
        pluck="name",
    )
    if not channel_names:
        return {
            "channel": channel,
            "tenant": tenant,
            "is_authenticated": is_authenticated,
            "identity_type": identity_type,
            "categories": [],
            "knowledge_delivery_enabled": True,
        }

    auth_filters = {
        "channel": ["in", channel_names],
        "enabled": 1,
        "published": 1,
        "visibility": ["in", ["External", "Both"]],
    }
    if tenant:
        auth_filters["tenant"] = tenant

    candidates = frappe.get_all(
        "Nexus Chat Category",
        filters=auth_filters,
        fields=[
            "name",
            "channel",
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
        return {
            "channel": channel,
            "tenant": tenant,
            "is_authenticated": is_authenticated,
            "identity_type": identity_type,
            "categories": [],
            "knowledge_delivery_enabled": True,
        }

    candidate_names = [c.name for c in candidates]

    _route_filters = {
        "channel": ["in", channel_names],
        "chat_category": ["in", candidate_names],
        "enabled": 1,
        "published": 1,
    }
    if tenant:
        _route_filters["tenant"] = tenant
    routed_categories = set(frappe.get_all(
        "Nexus Category Identity Route",
        filters=_route_filters,
        pluck="chat_category",
    ))

    categories = [c for c in candidates if c.name in routed_categories]
    for category in categories:
        category["faq_questions"] = get_category_faq_questions(category.name)

    return {
        "channel": channel,
        "tenant": tenant,
        "channels": channel_names,
        "is_authenticated": is_authenticated,
        "identity_type": identity_type,
        "categories": categories,
        "knowledge_delivery_enabled": True,
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
    widget_code = payload.get("widget_code")
    validate_widget_origin(widget_code)
    check_rate_limit(
        f"ask:{get_caller_ip()}",
        max_calls=30, window_seconds=60,
        throw_message="Too many requests. Please slow down.",
    )
    widget = _resolve_widget_for_api_call(widget_code)
    if widget and not widget.knowledge_delivery_enabled:
        return {
            "status": "service_paused",
            "knowledge_delivery_enabled": False,
            "message": "This service is temporarily paused.",
        }
    return ask_live_question(payload)


@frappe.whitelist(allow_guest=True)
def start_chat(payload=None):
    """
    Start a new live chat conversation.
    Returns immediately with conversation_id and status=processing.
    The AI response is pushed via frappe.realtime event "nexus_chat_response".
    """
    payload = parse_payload(payload)
    widget_code = payload.get("widget_code")
    validate_widget_origin(widget_code)
    check_rate_limit(
        f"start_chat:{get_caller_ip()}",
        max_calls=10, window_seconds=60,
        throw_message="Too many chat sessions started. Please wait a moment.",
    )
    widget = _resolve_widget_for_api_call(widget_code)
    if widget and not widget.knowledge_delivery_enabled:
        return {
            "status": "service_paused",
            "knowledge_delivery_enabled": False,
            "message": "This service is temporarily paused.",
        }
    result = start_live_chat(payload)
    try:
        settings = frappe.get_single("Nexus Settings")
        result["show_correlated_on_desk"] = bool(getattr(settings, "show_correlated_on_desk", 0))
    except Exception:
        result["show_correlated_on_desk"] = False

    # Attach the token based on the conversation mode, not the HTTP session. A desk
    # user can legitimately exercise the public widget with roles=["Guest"].
    conv_id = result.get("conversation_id")
    if conv_id:
        conversation_access = frappe.db.get_value(
            "Nexus Live Conversation",
            {"conversation_id": conv_id},
            ["user_type", "caller_token", "channel"],
            as_dict=True,
        )
        if (
            conversation_access
            and conversation_access.user_type == "Guest"
            and conversation_access.caller_token
        ):
            result["caller_token"] = conversation_access.caller_token

        # Expose WhatsApp phone so the widget can show a live "Continue on WhatsApp" link
        if conversation_access and conversation_access.channel:
            try:
                wa_phone = frappe.db.get_value(
                    "Nexus Live Channel",
                    conversation_access.channel,
                    "whatsapp_phone_display",
                )
                if wa_phone:
                    result["whatsapp_phone"] = wa_phone
            except Exception:
                pass

    return result


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
    widget_code = payload.get("widget_code")
    validate_widget_origin(widget_code)
    check_rate_limit(
        f"send_msg:{get_caller_ip()}",
        max_calls=60, window_seconds=60,
        throw_message="Too many messages. Please slow down.",
    )
    widget = _resolve_widget_for_api_call(widget_code)
    if widget and not widget.knowledge_delivery_enabled:
        frappe.throw("Knowledge delivery is currently paused for this widget.")

    return continue_live_chat(
        conversation_id=conversation_id,
        payload=payload,
    )


@frappe.whitelist(allow_guest=True)
def close_chat(conversation_id=None, caller_token=None, widget_code=None):
    """Close a visitor conversation and release its active agent session."""
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    validate_widget_origin(widget_code)
    check_rate_limit(
        f"close_chat:{get_caller_ip()}",
        max_calls=20,
        window_seconds=60,
        throw_message="Too many close requests. Please slow down.",
    )

    conversation = get_conversation(conversation_id)
    if not conversation:
        return {"status": "closed", "conversation_id": conversation_id}

    if conversation.status == "Closed":
        return {"status": "closed", "conversation_id": conversation.conversation_id}

    if conversation.user_type == "Guest":
        if not caller_token or caller_token != conversation.caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

    from digitz_ai_nexus_live.services.live_chat_service import _close_conversation_gracefully

    _close_conversation_gracefully(
        conversation,
        farewell="This conversation was closed by the visitor.",
    )

    return {"status": "closed", "conversation_id": conversation.conversation_id}


@frappe.whitelist(allow_guest=True)
def request_whatsapp_registration(conversation_id=None, phone=None, caller_token=None):
    """
    Send a WhatsApp OTP to the supplied phone number.
    Visitor calls this after clicking "Continue on WhatsApp" in the widget.
    """
    if not conversation_id or not phone:
        frappe.throw("Conversation ID and phone number are required.")

    check_rate_limit(
        f"wa_otp:{get_caller_ip()}",
        max_calls=5, window_seconds=300,
        throw_message="Too many OTP requests. Please wait a few minutes.",
    )

    conversation = get_conversation(conversation_id)
    if not conversation:
        frappe.throw("Conversation not found.")
    if conversation.user_type == "Guest":
        if not caller_token or caller_token != conversation.caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

    from digitz_ai_nexus_live.services.whatsapp_otp_service import request_whatsapp_otp
    return request_whatsapp_otp(conversation_id, phone)


@frappe.whitelist(allow_guest=True)
def verify_whatsapp_registration(conversation_id=None, otp=None, caller_token=None):
    """
    Verify the WhatsApp OTP entered by the visitor.
    On success switches conversation delivery to WhatsApp and fires a realtime
    confirmation event so the widget can update its UI.
    """
    if not conversation_id or not otp:
        frappe.throw("Conversation ID and OTP are required.")

    conversation = get_conversation(conversation_id)
    if not conversation:
        frappe.throw("Conversation not found.")
    if conversation.user_type == "Guest":
        if not caller_token or caller_token != conversation.caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

    from digitz_ai_nexus_live.services.whatsapp_otp_service import verify_whatsapp_otp
    result = verify_whatsapp_otp(conversation_id, otp)

    # Notify the widget via realtime so it can update UI without polling
    if result.get("status") == "verified":
        from digitz_ai_nexus_live.services.chat_realtime import publish_chat_response
        publish_chat_response(conversation_id, {
            "status": "success",
            "response_type": "whatsapp_registered",
            "phone": result.get("phone"),
            "message": (
                "Your WhatsApp is now connected. "
                "Replies from Nexy will be delivered to your WhatsApp. "
                "You can close this window and continue the conversation there."
            ),
        })

    return result


@frappe.whitelist(allow_guest=True)
def request_chat_transcript(conversation_id=None, email=None, caller_token=None):
    """
    Request an email copy of the conversation.

    If the supplied email matches the already-verified visitor_email on the
    conversation, the transcript is sent immediately (no OTP).
    Otherwise a 6-digit OTP is emailed to the address for verification.
    """
    if not conversation_id or not email:
        frappe.throw("Conversation ID and email are required.")

    conversation = get_conversation(conversation_id)
    if not conversation:
        frappe.throw("Conversation not found.")
    if conversation.user_type == "Guest":
        if not caller_token or caller_token != conversation.caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

    check_rate_limit(
        f"transcript_req:{get_caller_ip()}",
        max_calls=5, window_seconds=300,
        throw_message="Too many requests. Please wait before requesting again.",
    )

    from digitz_ai_nexus_live.services.chat_transcript_service import request_chat_transcript as _request
    return _request(conversation_id, email)


@frappe.whitelist(allow_guest=True)
def verify_chat_transcript_otp(conversation_id=None, otp=None, caller_token=None):
    """
    Verify the transcript OTP and deliver the email copy on success.
    """
    if not conversation_id or not otp:
        frappe.throw("Conversation ID and OTP are required.")

    conversation = get_conversation(conversation_id)
    if not conversation:
        frappe.throw("Conversation not found.")
    if conversation.user_type == "Guest":
        if not caller_token or caller_token != conversation.caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

    from digitz_ai_nexus_live.services.chat_transcript_service import verify_chat_transcript_otp as _verify
    result = _verify(conversation_id, otp)

    if result.get("status") == "sent":
        from digitz_ai_nexus_live.services.chat_realtime import publish_chat_response
        publish_chat_response(conversation_id, {
            "status": "success",
            "response_type": "transcript_sent",
            "email": result.get("email"),
        })

    return result


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
def get_conversation_detail(conversation_id=None, caller_token=None):
    """
    Return full conversation metadata + messages.
    Called by both the Live Console (desk) and the website widget (guest resume).
    Guest callers must supply the caller_token issued at start_chat time.
    """
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    is_guest = frappe.session.user in ("Guest", None, "")

    if is_guest:
        if not caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)
        stored_token = frappe.db.get_value(
            "Nexus Live Conversation",
            {"conversation_id": conversation_id},
            "caller_token",
        )
        if not stored_token or stored_token != caller_token:
            frappe.throw("Access denied.", frappe.PermissionError)

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
