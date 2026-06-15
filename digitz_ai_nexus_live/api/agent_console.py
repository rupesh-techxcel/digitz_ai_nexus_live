import frappe
from frappe.utils import now_datetime

from digitz_ai_nexus_live.services.agent_service import decrement_active_sessions
from digitz_ai_nexus_live.services.chat_realtime import (
    publish_chat_response,
    ESCALATION_CLAIMED_EVENT,
)
from digitz_ai_nexus_live.services.conversation_service import add_message, mark_escalated


def _get_human_assignment(user=None):
    """Return the active Nexus User Profile Assignment for the session user if they can handle escalations."""
    user = user or frappe.session.user

    name = frappe.db.get_value(
        "Nexus User Profile Assignment",
        {"user": user, "active": 1, "can_handle_escalations": 1},
        "name",
    )

    if not name:
        return None

    return frappe.get_doc("Nexus User Profile Assignment", name)


def _get_conversation_name(conversation_id):
    return frappe.db.get_value(
        "Nexus Live Conversation", {"conversation_id": conversation_id}, "name"
    )


def _get_user_display_name(user):
    return frappe.db.get_value("User", user, "full_name") or user


@frappe.whitelist()
def get_agent_context():
    """
    Return the current user's escalation handling config and category assignments.
    Used by the console to detect agent mode on page load.
    """
    user = frappe.session.user
    if user == "Guest":
        return {"is_agent": False}

    assignment = _get_human_assignment(user)
    if not assignment:
        return {"is_agent": False}

    categories = [row.chat_category for row in (assignment.escalation_categories or [])]

    return {
        "is_agent": True,
        "agent": user,
        "nickname": _get_user_display_name(user),
        "categories": categories,
    }


@frappe.whitelist()
def claim_conversation(conversation_id):
    """
    Take over a conversation as a human agent. Works for any active conversation:
    - If already Escalated: claim it directly.
    - If Open / Responding / Waiting: auto-escalate (manual takeover) then claim.
    Notifies the visitor and broadcasts the claim to other watching agents.
    """
    user = frappe.session.user
    assignment = _get_human_assignment(user)
    is_sysmanager = "System Manager" in frappe.get_roles(user)
    if not assignment and not is_sysmanager:
        frappe.throw("No active escalation-enabled profile found for the current user.")

    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    status = frappe.db.get_value("Nexus Live Conversation", conv_name, "status")
    if status == "Closed":
        frappe.throw("Cannot take over a closed conversation.")

    # Manual takeover: escalate the conversation first if not already escalated
    if status != "Escalated":
        conv = frappe.get_doc("Nexus Live Conversation", conv_name)
        mark_escalated(conv)

        # Let the visitor know a human is joining
        joining_msg = "A support agent is joining this conversation to assist you."
        add_message(
            conversation=conv,
            sender_type="System",
            message=joining_msg,
            response_mode="chat",
        )
        publish_chat_response(conversation_id, {
            "status": "escalated",
            "response_type": "agent_joined",
            "message": joining_msg,
            "answer": joining_msg,
            "confidence": 1.0,
            "access_status": "escalated",
            "sources": [],
        })

    frappe.db.set_value("Nexus Live Conversation", conv_name, {
        "human_agent": user,
        "escalation_status": "Accepted",
    })
    frappe.db.commit()

    nickname = _get_user_display_name(user)

    frappe.publish_realtime(
        event=ESCALATION_CLAIMED_EVENT,
        message={
            "conversation_id": conversation_id,
            "claimed_by_agent": user,
            "claimed_by_nickname": nickname,
        },
        after_commit=True,
    )

    return {"success": True, "agent": user, "nickname": nickname}


@frappe.whitelist()
def agent_send_message(conversation_id, message):
    """
    Human agent sends a message in an escalated conversation.
    Stored as Human Agent message and pushed to the visitor's widget.
    """
    user = frappe.session.user
    assignment = _get_human_assignment(user)
    if not assignment:
        frappe.throw("No active escalation-enabled profile found.")

    message = (message or "").strip()
    if not message:
        frappe.throw("Message is required.")

    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    nickname = _get_user_display_name(user)

    msg = frappe.new_doc("Nexus Live Message")
    msg.conversation = conv_name
    msg.sender_type = "Human Agent"
    msg.message = message
    msg.response_mode = "chat"
    msg.message_time = now_datetime()
    msg.insert(ignore_permissions=True)

    frappe.db.set_value("Nexus Live Conversation", conv_name, {
        "last_response": message[:140],
        "last_message_at": now_datetime(),
    }, update_modified=False)

    publish_chat_response(conversation_id, {
        "status": "success",
        "response_type": "message",
        "message": message,
        "answer": message,
        "sender_type": "Human Agent",
        "sender_name": nickname,
        "confidence": 1.0,
        "access_status": "human_agent",
        "sources": [],
    })

    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def resolve_escalation(conversation_id):
    """Human agent resolves escalation — AI resumes responding."""
    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    frappe.db.set_value("Nexus Live Conversation", conv_name, {
        "status": "Responding",
        "escalation_status": "Resolved",
        "human_agent": None,
        "intent": "post_escalation",
    })

    pending = frappe.get_all(
        "Nexus Live Escalation",
        filters={"conversation": conv_name, "status": "Pending"},
        pluck="name",
    )
    for esc_name in pending:
        frappe.db.set_value("Nexus Live Escalation", esc_name, {
            "status": "Resolved",
            "resolved_on": now_datetime(),
        })

    resolution_msg = (
        "You've been reconnected with our AI assistant. "
        "Feel free to continue with your questions."
    )

    conv = frappe.get_doc("Nexus Live Conversation", conv_name)
    add_message(
        conversation=conv,
        sender_type="System",
        message=resolution_msg,
        response_mode="chat",
    )

    publish_chat_response(conversation_id, {
        "status": "success",
        "response_type": "escalation_resolved",
        "message": resolution_msg,
        "answer": resolution_msg,
        "confidence": 1.0,
        "access_status": "conversational",
        "sources": [],
    })

    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def close_conversation_by_agent(conversation_id):
    """Human agent closes the conversation with a farewell message."""
    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    farewell = (
        "Thank you for reaching out. This conversation has been closed by our support agent. "
        "Have a great day — feel free to start a new chat whenever you need help!"
    )

    conv = frappe.get_doc("Nexus Live Conversation", conv_name)
    assigned_agent = conv.assigned_agent

    add_message(
        conversation=conv,
        sender_type="System",
        message=farewell,
        response_mode="chat",
    )

    frappe.db.set_value("Nexus Live Conversation", conv_name, {
        "status": "Closed",
        "closed_on": now_datetime(),
        "intent": "",
        "human_agent": None,
    })

    if assigned_agent:
        try:
            decrement_active_sessions(assigned_agent, conversation=conv_name)
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Nexus Live: Failed to decrement agent sessions on agent close",
            )

    publish_chat_response(conversation_id, {
        "status": "closed",
        "response_type": "conversation_closed",
        "message": farewell,
        "answer": farewell,
        "confidence": 1.0,
        "access_status": "closed",
        "sources": [],
    })

    frappe.db.commit()
    return {"success": True}
