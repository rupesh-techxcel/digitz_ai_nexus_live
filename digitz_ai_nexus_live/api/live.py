import json
import frappe

from digitz_ai_nexus_live.services.live_qa_service import ask_live_question
from digitz_ai_nexus_live.services.live_chat_service import (
    start_live_chat,
    continue_live_chat,
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
    """
    Public / internal Q And A API endpoint.
    """
    payload = parse_payload(payload)

    return ask_live_question(payload)


@frappe.whitelist(allow_guest=True)
def start_chat(payload=None):
    """
    Start a new live chat conversation.
    """
    payload = parse_payload(payload)

    return start_live_chat(payload)


@frappe.whitelist(allow_guest=True)
def send_chat_message(conversation_id=None, payload=None):
    """
    Continue an existing live chat conversation.
    """
    if not conversation_id:
        frappe.throw("Conversation ID is required.")

    payload = parse_payload(payload)

    return continue_live_chat(
        conversation_id=conversation_id,
        payload=payload,
    )
