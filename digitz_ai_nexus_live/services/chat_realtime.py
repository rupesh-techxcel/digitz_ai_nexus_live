import frappe

CHAT_RESPONSE_EVENT = "nexus_chat_response"
CHAT_TYPING_EVENT = "nexus_chat_typing"


def publish_chat_response(conversation_id, data):
    frappe.publish_realtime(
        event=CHAT_RESPONSE_EVENT,
        message={"conversation_id": conversation_id, **data},
        after_commit=True,
    )


def publish_chat_typing(conversation_id):
    frappe.publish_realtime(
        event=CHAT_TYPING_EVENT,
        message={"conversation_id": conversation_id},
        after_commit=True,
    )


def publish_chat_error(conversation_id, error_message):
    frappe.publish_realtime(
        event=CHAT_RESPONSE_EVENT,
        message={
            "conversation_id": conversation_id,
            "status": "error",
            "error": error_message,
        },
        after_commit=True,
    )
