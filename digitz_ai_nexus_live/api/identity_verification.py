import frappe

from digitz_ai_nexus_live.services.identity_verification import (
    request_verification,
    verify_challenge,
)
from digitz_ai_nexus_live.services.rate_limit import check_rate_limit, get_caller_ip

# Companion pending actions that require OTP even when the chat category's
# identity_verification_mode is "None".
_COMPANION_EMAIL_COLLECT_ACTIONS = frozenset({
    "collect_email_for_consultancy",
    "collect_email_for_appointment",
})


@frappe.whitelist(allow_guest=True)
def request_identity_verification(channel=None, chat_category=None, email=None, conversation_id=None, pending_action=None):
    # 5 OTP requests per email per 10 minutes
    if email:
        check_rate_limit(
            f"otp_req:{email.strip().lower()}",
            max_calls=5, window_seconds=600,
            throw_message="Too many verification requests for this email. Please wait before trying again.",
        )
    check_rate_limit(
        f"otp_req_ip:{get_caller_ip()}",
        max_calls=10, window_seconds=60,
        throw_message="Too many verification requests. Please slow down.",
    )
    # Resolve channel + chat_category from an active conversation when not supplied directly.
    # The conversation stores chat_category as the category_code field value; we resolve
    # the canonical doc name here so request_verification always receives a doc name.
    conv_name = None
    if conversation_id:
        conv_name = frappe.db.get_value(
            "Nexus Live Conversation", {"conversation_id": conversation_id}, "name"
        )
        if conv_name:
            conv = frappe.get_doc("Nexus Live Conversation", conv_name)
            channel = channel or conv.channel
            if not chat_category and conv.chat_category:
                # conv.chat_category may be the category_code field or the doc name
                chat_category = _resolve_chat_category_name(conv.chat_category)

    if not channel:
        frappe.throw("Channel is required.")
    if not chat_category:
        frappe.throw("Chat category is required.")

    # When the companion controller is collecting email mid-conversation for a
    # booking/consultancy action, force OTP regardless of the category's
    # identity_verification_mode (which may be "None" for companion-only categories).
    # Primary: widget passes pending_action directly from the realtime event payload.
    # Fallback: read companion_pending_action from DB (covers reconnect / reload cases).
    force_mode = None
    _effective_pending = (pending_action or "").strip()
    if not _effective_pending and conv_name:
        _effective_pending = (
            frappe.db.get_value("Nexus Live Conversation", conv_name, "companion_pending_action")
            or ""
        ).strip()
    if _effective_pending in _COMPANION_EMAIL_COLLECT_ACTIONS:
        force_mode = "Email OTP"

    return request_verification(
        channel=channel,
        chat_category=chat_category,
        email=email,
        force_mode=force_mode,
    )


def _resolve_chat_category_name(value):
    """Return the Nexus Chat Category doc name for a given value.

    Accepts either the doc name or the category_code field value.
    """
    if not value:
        return None
    if frappe.db.exists("Nexus Chat Category", value):
        return value
    # Fall back to lookup by category_code field
    return frappe.db.get_value("Nexus Chat Category", {"category_code": value}, "name") or value


@frappe.whitelist(allow_guest=True)
def verify_identity_verification(challenge_token=None, otp=None):
    return verify_challenge(challenge_token=challenge_token, otp=otp)
