"""
WhatsApp bridge for Nexus Live.

Hooks into frappe_whatsapp's WhatsApp Message after_insert event and routes
incoming messages through the same Nexus Live AI pipeline used by the web widget.

Architecture: channel_type is irrelevant to delivery medium.
  - Any Nexus Live Channel with `whatsapp_account` configured accepts WhatsApp contacts.
  - A Nexus Live Conversation carries `delivery_method` = "Web" | "WhatsApp".
  - When delivery_method is "WhatsApp", _process_ai_response() sends the answer
    via frappe_whatsapp instead of (in addition to) the realtime WebSocket event.

Inbound routing for cold WhatsApp contacts (no prior web session):
  Phone → Nexus Web Visitor (visitor_phone) → open conversation on the channel
  linked to this WhatsApp account.  The channel's category config, AI profile,
  knowledge, and companion mode all apply identically.

Phone registration from the web widget:
  whatsapp_otp_service.py handles the OTP send/verify cycle.
  On success it sets delivery_method="WhatsApp" and visitor_phone on the
  conversation; from that point this file's outbound fork fires automatically.
"""

import json
import re

import frappe
from frappe.utils import add_to_date, now_datetime


_SESSION_HOURS = 24


# ── Public API ─────────────────────────────────────────────────────────────────

def on_whatsapp_message(doc, method):
    """After-insert hook: route incoming WhatsApp messages into the Nexus AI pipeline."""
    if doc.type != "Incoming":
        return
    if doc.content_type == "reaction":
        return

    phone = doc.get("from") or ""
    if not phone:
        return

    whatsapp_account = doc.whatsapp_account
    channel = _get_channel_for_account(whatsapp_account)
    if not channel:
        return  # No Nexus Live Channel configured for this WhatsApp account

    tenant = channel.tenant or ""
    profile_name = doc.profile_name or ""

    # Normalise message text
    message_text = doc.message or ""
    if doc.content_type in ("image", "audio", "video", "document"):
        label = doc.content_type.title()
        message_text = f"[{label} received]" + (f": {message_text}" if message_text else "")
    elif not message_text:
        return  # unknown type with no usable text

    visitor = _get_or_create_visitor(phone, profile_name, tenant)
    conversation, is_new = _get_or_create_conversation(visitor, channel)
    if not conversation:
        return

    if is_new:
        _handle_new_conversation(conversation, channel, phone, whatsapp_account, message_text)
    else:
        _handle_existing_conversation(
            conversation, channel, phone, whatsapp_account, message_text, doc.content_type
        )


def send_whatsapp_reply(phone, text, whatsapp_account_name):
    """Send a plain-text reply via frappe_whatsapp."""
    if not text or not phone:
        return
    try:
        frappe.get_doc({
            "doctype": "WhatsApp Message",
            "type": "Outgoing",
            "to": phone,
            "message": _strip_markdown(text)[:4096],
            "content_type": "text",
            "whatsapp_account": whatsapp_account_name,
        }).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus WhatsApp: send_whatsapp_reply failed")


def get_whatsapp_delivery_for_conversation(conversation):
    """
    Return (whatsapp_account_name, visitor_phone) when the conversation should be
    delivered via WhatsApp, or (None, None) otherwise.

    Checks conversation.delivery_method == "WhatsApp", not channel_type.
    """
    try:
        delivery = getattr(conversation, "delivery_method", None)
        if delivery != "WhatsApp":
            return None, None
        phone = getattr(conversation, "visitor_phone", None)
        if not phone:
            return None, None
        channel_name = getattr(conversation, "channel", None)
        if not channel_name:
            return None, None
        whatsapp_account = frappe.db.get_value(
            "Nexus Live Channel", channel_name, "whatsapp_account"
        )
        if not whatsapp_account:
            return None, None
        return whatsapp_account, phone
    except Exception:
        return None, None


# ── Inbound handling ───────────────────────────────────────────────────────────

def _handle_new_conversation(conversation, channel, phone, whatsapp_account, message_text):
    from digitz_ai_nexus_live.services.conversation_service import add_message

    greeting = _get_agent_greeting(conversation)
    if greeting:
        send_whatsapp_reply(phone, greeting, whatsapp_account)
        add_message(conversation=conversation, sender_type="AI Agent",
                    message=greeting, response_mode="chat")

    categories = _get_channel_categories(channel.name)

    if categories:
        _send_category_picker_whatsapp(conversation, categories, phone, whatsapp_account)
        _store_category_map(conversation.conversation_id, categories)
        frappe.db.set_value(
            "Nexus Live Conversation", conversation.name,
            "intent", "await_category", update_modified=False,
        )
    else:
        _enqueue_ai(conversation, message_text, phone)


def _handle_existing_conversation(conversation, channel, phone, whatsapp_account,
                                   message_text, content_type):
    intent = conversation.intent or ""

    if intent != "await_category":
        _enqueue_ai(conversation, message_text, phone)
        return

    # button / list reply — message IS the category_code
    if content_type == "button" and _is_valid_category(message_text, channel.name):
        _enqueue_ai(conversation, f"__cat__:{message_text}", phone)
        return

    # Numeric reply → index map
    cat_map = _load_category_map(conversation.conversation_id)
    resolved = cat_map.get(message_text.strip())

    # Text label match
    if not resolved:
        resolved = _match_category_text(message_text, channel.name)

    if resolved:
        _enqueue_ai(conversation, f"__cat__:{resolved}", phone)
    else:
        categories = _get_channel_categories(channel.name)
        send_whatsapp_reply(phone, "Please select one of the options below:", whatsapp_account)
        _send_category_picker_whatsapp(conversation, categories, phone, whatsapp_account)


# ── Category picker ────────────────────────────────────────────────────────────

def _send_category_picker_whatsapp(conversation, categories, phone, whatsapp_account):
    if not categories:
        return

    if len(categories) <= 10:
        buttons_data = [
            {
                "id": cat.category_code,
                "title": (cat.category_label or cat.category_code)[:24],
                "description": (cat.get("description") or "")[:72],
            }
            for cat in categories
        ]
        try:
            frappe.get_doc({
                "doctype": "WhatsApp Message",
                "type": "Outgoing",
                "to": phone,
                "message": "Please select a topic to get started:",
                "content_type": "interactive",
                "buttons": json.dumps(buttons_data),
                "whatsapp_account": whatsapp_account,
            }).insert(ignore_permissions=True)
            return
        except Exception:
            frappe.log_error(frappe.get_traceback(),
                             "Nexus WhatsApp: interactive picker failed — falling back to text")

    # Numbered text fallback
    lines = ["Please reply with the number of your choice:"]
    for i, cat in enumerate(categories, 1):
        desc = f" — {cat.get('description', '')}" if cat.get("description") else ""
        lines.append(f"{i}. {cat.category_label or cat.category_code}{desc}")
    send_whatsapp_reply(phone, "\n".join(lines), whatsapp_account)


# ── AI pipeline entry ──────────────────────────────────────────────────────────

def _enqueue_ai(conversation, message_text, phone):
    from digitz_ai_nexus_live.services.conversation_service import add_message

    is_cat = message_text.startswith("__cat__:")
    if not is_cat:
        add_message(conversation=conversation, sender_type="Visitor",
                    message=message_text, response_mode="chat")
        frappe.db.set_value(
            "Nexus Live Conversation", conversation.name,
            "last_message_at", now_datetime(), update_modified=False,
        )

    payload = {
        "channel": conversation.channel,
        "tenant": frappe.db.get_value("Nexus Live Channel", conversation.channel, "tenant") or "",
        "message": message_text,
        "user_type": "Guest",
        "visitor_phone": phone,
        "is_whatsapp": True,
    }

    from digitz_ai_nexus_live.services.live_chat_service import continue_live_chat
    frappe.enqueue(
        continue_live_chat,
        conversation_id=conversation.conversation_id,
        payload=payload,
        queue="short",
        enqueue_after_commit=True,
    )


# ── Identity & session ─────────────────────────────────────────────────────────

def _get_channel_for_account(whatsapp_account):
    """Return the first enabled channel linked to this WhatsApp account."""
    name = frappe.db.get_value(
        "Nexus Live Channel",
        {"whatsapp_account": whatsapp_account, "enabled": 1},
        "name",
    )
    return frappe.get_doc("Nexus Live Channel", name) if name else None


def _get_or_create_visitor(phone, profile_name, tenant):
    visitor_name = frappe.db.get_value(
        "Nexus Web Visitor", {"visitor_phone": phone, "tenant": tenant}, "name"
    )
    if visitor_name:
        frappe.db.set_value(
            "Nexus Web Visitor", visitor_name, "last_seen", now_datetime(), update_modified=False
        )
        return frappe.get_doc("Nexus Web Visitor", visitor_name)

    visitor = frappe.new_doc("Nexus Web Visitor")
    visitor.visitor_id = f"wa:{phone}"
    visitor.tenant = tenant
    visitor.visitor_type = "Anonymous"
    visitor.visitor_phone = phone
    visitor.first_seen = now_datetime()
    visitor.last_seen = now_datetime()
    visitor.insert(ignore_permissions=True)
    return visitor


def _get_or_create_conversation(visitor, channel):
    """Return active conversation (open + last_message_at within 24h) or create one."""
    cutoff = add_to_date(now_datetime(), hours=-_SESSION_HOURS)
    existing = frappe.db.get_value(
        "Nexus Live Conversation",
        {
            "web_visitor": visitor.name,
            "channel": channel.name,
            "status": "Open",
            "last_message_at": [">=", cutoff],
        },
        "name",
        order_by="creation desc",
    )
    if existing:
        return frappe.get_doc("Nexus Live Conversation", existing), False

    from digitz_ai_nexus_live.services.agent_router import assign_agent
    from digitz_ai_nexus_live.services.conversation_service import create_conversation

    payload = {
        "channel": channel.name,
        "tenant": channel.tenant,
        "conversation_type": "Chat",
        "user_type": "Guest",
        "visitor_phone": visitor.visitor_phone,
        "visitor_id": visitor.visitor_id,
    }

    agent = None
    if channel.default_agent:
        try:
            agent = frappe.get_doc("Nexus AI Agent Profile", channel.default_agent)
        except Exception:
            pass
    if not agent:
        agent = assign_agent(payload)
    if not agent:
        frappe.log_error(f"No agent for channel {channel.name}", "Nexus WhatsApp: No agent")
        return None, False

    conversation = create_conversation(payload=payload, assigned_agent=agent)
    frappe.db.set_value(
        "Nexus Live Conversation", conversation.name,
        {
            "web_visitor": visitor.name,
            "last_message_at": now_datetime(),
            "delivery_method": "WhatsApp",
        },
        update_modified=False,
    )
    conversation.web_visitor = visitor.name
    conversation.delivery_method = "WhatsApp"
    return conversation, True


# ── Category helpers ───────────────────────────────────────────────────────────

def _get_channel_categories(channel_name):
    return frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel_name, "enabled": 1, "published": 1},
        fields=["name", "category_code", "category_label", "description"],
        order_by="display_order asc, category_label asc",
    )


def _store_category_map(conversation_id, categories):
    cat_map = {str(i + 1): c.category_code for i, c in enumerate(categories)}
    frappe.cache().set_value(
        f"nexus_wa_cat_map:{conversation_id}",
        json.dumps(cat_map),
        expires_in_sec=_SESSION_HOURS * 3600,
    )


def _load_category_map(conversation_id):
    raw = frappe.cache().get_value(f"nexus_wa_cat_map:{conversation_id}") or "{}"
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _is_valid_category(code, channel_name):
    return bool(frappe.db.exists(
        "Nexus Chat Category",
        {"category_code": code, "channel": channel_name, "enabled": 1, "published": 1},
    ))


def _match_category_text(text, channel_name):
    cats = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel_name, "enabled": 1, "published": 1},
        fields=["category_code", "category_label"],
    )
    text_lower = text.strip().lower()
    for cat in cats:
        if text_lower in ((cat.category_label or "").lower(), cat.category_code.lower()):
            return cat.category_code
    return None


# ── Misc helpers ───────────────────────────────────────────────────────────────

def _get_agent_greeting(conversation):
    try:
        return frappe.db.get_value(
            "Nexus AI Agent Profile", conversation.assigned_agent, "welcome_message"
        ) or None
    except Exception:
        return None


def _strip_markdown(text):
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"```[\s\S]*?```", "[code block]", text)
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    return text.strip()
