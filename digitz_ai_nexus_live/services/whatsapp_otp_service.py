"""
WhatsApp phone OTP registration service.

Allows a web-widget visitor to register their WhatsApp phone number so that
Nexy's responses are delivered there instead of (or alongside) the browser.
The flow mirrors the existing email OTP identity verification:

  1. Visitor clicks "Continue on WhatsApp" in the widget
  2. Widget prompts for phone number → calls request_whatsapp_otp()
  3. Service generates a 6-digit OTP, caches it (5 min TTL),
     sends it as a WhatsApp message via frappe_whatsapp
  4. Visitor enters the OTP in the widget → calls verify_whatsapp_otp()
  5. On success: conversation.visitor_phone is set,
                 conversation.delivery_method = "WhatsApp"
     From this point all Nexy replies go to WhatsApp via the outbound fork
     in _process_ai_response().

The WhatsApp account used for sending the OTP is resolved from the channel
linked to the conversation. Any channel that has `whatsapp_account` configured
can offer WhatsApp registration to its visitors.
"""

import random
import string

import frappe
from frappe.utils import now_datetime


_OTP_TTL_SECONDS = 300   # 5 minutes
_OTP_DIGITS = 6
_MAX_ATTEMPTS = 5


def request_whatsapp_otp(conversation_id, phone):
    """
    Generate and send a WhatsApp OTP to the supplied phone number.

    Returns {"status": "sent"} on success or raises frappe.ValidationError.
    """
    phone = _normalise_phone(phone)
    if not phone:
        frappe.throw("Please enter a valid WhatsApp phone number including country code.")

    conversation = _get_conversation(conversation_id)
    whatsapp_account = _resolve_whatsapp_account(conversation)
    if not whatsapp_account:
        frappe.throw("WhatsApp is not configured for this channel. Please contact support.")

    if conversation.delivery_method == "WhatsApp" and conversation.visitor_phone:
        frappe.throw("WhatsApp is already registered for this conversation.")

    otp = _generate_otp()
    _store_otp(conversation_id, phone, otp)

    _send_otp_message(phone, otp, whatsapp_account)

    # Stash the unverified phone on the conversation so verify step can cross-check
    frappe.db.set_value(
        "Nexus Live Conversation", conversation.name,
        "wa_otp_phone", phone,
        update_modified=False,
    )

    return {"status": "sent", "phone": _mask_phone(phone)}


def verify_whatsapp_otp(conversation_id, otp_input):
    """
    Verify the OTP entered by the visitor.

    On success:
    - Sets conversation.visitor_phone = verified phone
    - Sets conversation.delivery_method = "WhatsApp"
    - Creates / links Nexus Web Visitor with this phone
    - Clears the OTP from cache and wa_otp_phone

    Returns {"status": "verified"} or raises frappe.ValidationError.
    """
    conversation = _get_conversation(conversation_id)

    stored = _load_otp(conversation_id)
    if not stored:
        frappe.throw("Your verification code has expired. Please request a new one.")

    if stored.get("attempts", 0) >= _MAX_ATTEMPTS:
        _clear_otp(conversation_id)
        frappe.throw("Too many incorrect attempts. Please request a new code.")

    if stored.get("otp") != otp_input.strip():
        stored["attempts"] = stored.get("attempts", 0) + 1
        frappe.cache().set_value(
            _otp_key(conversation_id), stored, expires_in_sec=_OTP_TTL_SECONDS
        )
        remaining = _MAX_ATTEMPTS - stored["attempts"]
        frappe.throw(f"Incorrect code. {remaining} attempt(s) remaining.")

    phone = stored["phone"]
    _clear_otp(conversation_id)

    # Commit the verified phone and switch delivery method
    frappe.db.set_value(
        "Nexus Live Conversation", conversation.name,
        {
            "visitor_phone": phone,
            "delivery_method": "WhatsApp",
            "wa_otp_phone": "",
        },
        update_modified=False,
    )

    # Link / create Nexus Web Visitor for this phone (for future inbound routing)
    _link_whatsapp_visitor(conversation, phone)

    return {"status": "verified", "phone": _mask_phone(phone)}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _get_conversation(conversation_id):
    conv = frappe.db.get_value(
        "Nexus Live Conversation",
        {"conversation_id": conversation_id},
        ["name", "channel", "visitor_phone", "delivery_method", "status", "web_visitor"],
        as_dict=True,
    )
    if not conv:
        frappe.throw("Conversation not found.")
    if conv.status == "Closed":
        frappe.throw("This conversation is closed.")
    return conv


def _resolve_whatsapp_account(conversation):
    """Return the whatsapp_account name linked to the conversation's channel."""
    if not conversation.channel:
        return None
    return frappe.db.get_value("Nexus Live Channel", conversation.channel, "whatsapp_account") or None


def _generate_otp():
    return "".join(random.choices(string.digits, k=_OTP_DIGITS))


def _otp_key(conversation_id):
    return f"nexus_wa_otp:{conversation_id}"


def _store_otp(conversation_id, phone, otp):
    frappe.cache().set_value(
        _otp_key(conversation_id),
        {"otp": otp, "phone": phone, "attempts": 0, "sent_at": str(now_datetime())},
        expires_in_sec=_OTP_TTL_SECONDS,
    )


def _load_otp(conversation_id):
    return frappe.cache().get_value(_otp_key(conversation_id))


def _clear_otp(conversation_id):
    frappe.cache().delete_value(_otp_key(conversation_id))


def _send_otp_message(phone, otp, whatsapp_account):
    message = (
        f"Your Nexy verification code is: *{otp}*\n\n"
        f"This code expires in 5 minutes. Do not share it with anyone."
    )
    try:
        frappe.get_doc({
            "doctype": "WhatsApp Message",
            "type": "Outgoing",
            "to": phone,
            "message": message,
            "content_type": "text",
            "whatsapp_account": whatsapp_account,
        }).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus WhatsApp OTP: send failed")
        frappe.throw("Could not send WhatsApp message. Please check your number and try again.")


def _link_whatsapp_visitor(conversation, phone):
    """Create or update Nexus Web Visitor with this phone for future inbound routing."""
    try:
        tenant = frappe.db.get_value("Nexus Live Channel", conversation.channel, "tenant") or ""

        visitor_name = frappe.db.get_value(
            "Nexus Web Visitor", {"visitor_phone": phone, "tenant": tenant}, "name"
        )
        if visitor_name:
            frappe.db.set_value(
                "Nexus Web Visitor", visitor_name,
                {"last_seen": now_datetime(), "visitor_type": "Known"},
                update_modified=False,
            )
            # Link to conversation if not already
            if not conversation.web_visitor:
                frappe.db.set_value(
                    "Nexus Live Conversation", conversation.name,
                    "web_visitor", visitor_name,
                    update_modified=False,
                )
        else:
            # Create new visitor record
            visitor = frappe.new_doc("Nexus Web Visitor")
            visitor.visitor_id = f"wa:{phone}"
            visitor.tenant = tenant
            visitor.visitor_type = "Known"
            visitor.visitor_phone = phone
            visitor.first_seen = now_datetime()
            visitor.last_seen = now_datetime()
            visitor.insert(ignore_permissions=True)

            if not conversation.web_visitor:
                frappe.db.set_value(
                    "Nexus Live Conversation", conversation.name,
                    "web_visitor", visitor.name,
                    update_modified=False,
                )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus WhatsApp OTP: visitor link failed")


def _normalise_phone(phone):
    """Strip spaces, dashes, parentheses. Keep leading + if present."""
    if not phone:
        return ""
    import re
    cleaned = re.sub(r"[\s\-().]+", "", phone.strip())
    # Must be digits only (with optional leading +)
    if not re.match(r"^\+?\d{7,15}$", cleaned):
        return ""
    # Remove leading + — frappe_whatsapp's format_number handles it
    return cleaned.lstrip("+")


def _mask_phone(phone):
    """Return a masked version for display: last 4 digits visible."""
    if len(phone) <= 4:
        return phone
    return "*" * (len(phone) - 4) + phone[-4:]
