import frappe

CHAT_RESPONSE_EVENT = "nexus_chat_response"
CHAT_TYPING_EVENT = "nexus_chat_typing"
ESCALATION_ALERT_EVENT = "nexus_escalation_alert"
ESCALATION_CLAIMED_EVENT = "nexus_escalation_claimed"


def publish_chat_response(conversation_id, data):
    frappe.publish_realtime(
        event=CHAT_RESPONSE_EVENT,
        message={"conversation_id": conversation_id, **data},
        task_id=conversation_id,
    )


def publish_chat_typing(conversation_id):
    frappe.publish_realtime(
        event=CHAT_TYPING_EVENT,
        message={"conversation_id": conversation_id},
        task_id=conversation_id,
    )


def publish_chat_error(conversation_id, error_message):
    frappe.publish_realtime(
        event=CHAT_RESPONSE_EVENT,
        message={
            "conversation_id": conversation_id,
            "status": "error",
            "error": error_message,
        },
        task_id=conversation_id,
    )


def publish_escalation_alert(conversation):
    """
    Notify all desk users who can handle escalations for the conversation's
    chat category that a new escalation is waiting.
    """
    chat_category = getattr(conversation, "chat_category", None)
    visitor_name = getattr(conversation, "visitor_name", None) or "Visitor"
    conversation_id = getattr(conversation, "conversation_id", None)

    agent_users = _get_agent_users_for_category(chat_category)

    category_label = None
    if chat_category:
        category_label = frappe.db.get_value("Nexus Chat Category", chat_category, "category_label")

    alert_data = {
        "conversation_id": conversation_id,
        "conversation_name": conversation.name,
        "visitor_name": visitor_name,
        "chat_category": chat_category,
        "category_label": category_label or chat_category,
        "escalated_at": str(conversation.escalated_at) if getattr(conversation, "escalated_at", None) else None,
    }

    if agent_users:
        for user in agent_users:
            frappe.publish_realtime(
                event=ESCALATION_ALERT_EVENT,
                message=alert_data,
                user=user,
                after_commit=True,
            )
    else:
        frappe.publish_realtime(
            event=ESCALATION_ALERT_EVENT,
            message=alert_data,
            after_commit=True,
        )


def _get_agent_users_for_category(chat_category):
    """
    Return Frappe usernames of active desk users who can handle escalations
    and have this chat category in their escalation_categories list.
    """
    if not chat_category:
        return []

    # Find assignments where the category appears in escalation_categories child table
    assignment_names = frappe.get_all(
        "Nexus Chat Category Link",
        filters={
            "chat_category": chat_category,
            "parenttype": "Nexus User Profile Assignment",
        },
        pluck="parent",
    )

    if not assignment_names:
        return []

    users = []
    for assignment_name in assignment_names:
        row = frappe.db.get_value(
            "Nexus User Profile Assignment",
            {"name": assignment_name, "active": 1, "can_handle_escalations": 1},
            "user",
        )
        if row:
            users.append(row)

    return list(set(users))
