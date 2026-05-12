import json
import frappe

from digitz_ai_nexus_live.services.live_qa_service import ask_live_question
from digitz_ai_nexus_live.services.live_chat_service import (
    start_live_chat,
    continue_live_chat,
)


def parse_payload(payload=None):
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except Exception:
            frappe.throw("Invalid JSON payload.")

    return payload or {}


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