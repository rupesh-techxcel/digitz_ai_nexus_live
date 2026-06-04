import frappe

from digitz_ai_nexus_live.services.identity_verification import (
    request_verification,
    verify_challenge,
)


@frappe.whitelist(allow_guest=True)
def request_identity_verification(channel=None, chat_category=None, email=None):
    if not channel:
        frappe.throw("Channel is required.")
    if not chat_category:
        frappe.throw("Chat category is required.")

    return request_verification(
        channel=channel,
        chat_category=chat_category,
        email=email,
    )


@frappe.whitelist(allow_guest=True)
def verify_identity_verification(challenge_token=None, otp=None):
    return verify_challenge(challenge_token=challenge_token, otp=otp)
