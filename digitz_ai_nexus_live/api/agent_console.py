import frappe
from frappe.utils import now_datetime

from digitz_ai_nexus_live.services.agent_service import decrement_active_sessions
from digitz_ai_nexus_live.services.chat_realtime import (
    publish_chat_response,
    ESCALATION_APPROVED_EVENT,
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

    conv = frappe.get_doc("Nexus Live Conversation", conv_name)
    msg = add_message(
        conversation=conv,
        sender_type="Human Agent",
        message=message,
        response_mode="chat",
    )

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
    return {
        "success": True,
        "message": {
            "name": msg.name,
            "sender_type": "Human Agent",
            "sender_name": nickname,
            "message": message,
            "message_time": str(msg.message_time),
        },
    }


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


@frappe.whitelist()
def approve_escalation_request(conversation_id):
    """
    Desk agent approves a visitor's escalation request.
    If the visitor's email is already verified, escalation completes immediately.
    Otherwise the visitor is prompted to verify their email via OTP before the
    conversation is handed to a human agent.
    """
    user = frappe.session.user
    is_sysmanager = "System Manager" in frappe.get_roles(user)
    assignment = _get_human_assignment(user)
    if not assignment and not is_sysmanager:
        frappe.throw("No active escalation-enabled profile found for the current user.")

    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    esc_status = frappe.db.get_value("Nexus Live Conversation", conv_name, "escalation_status")
    if esc_status != "Requested":
        frappe.throw("No pending escalation request for this conversation.")

    conv = frappe.get_doc("Nexus Live Conversation", conv_name)

    if conv.visitor_email:
        # Email already verified — complete escalation immediately
        from digitz_ai_nexus_live.services.escalation_service import _complete_approved_escalation
        _complete_approved_escalation(conv_name)
    else:
        # Prompt visitor to verify email before completing escalation
        frappe.db.set_value("Nexus Live Conversation", conv_name, "intent", "await_escalation_verification")
        frappe.db.commit()

        approval_msg = (
            "Your escalation request has been reviewed and approved. "
            "To connect you with our team, please verify your email address — "
            "check the verification prompt in the chat."
        )
        add_message(
            conversation=conv,
            sender_type="System",
            message=approval_msg,
            response_mode="chat",
        )
        publish_chat_response(conversation_id, {
            "status": "escalation_approved",
            "response_type": "message",
            "message": approval_msg,
            "answer": approval_msg,
            "confidence": 1.0,
            "sources": [],
            "identity_verification_offer": True,
        })

        frappe.publish_realtime(
            event=ESCALATION_APPROVED_EVENT,
            message={
                "conversation_id": conversation_id,
                "requires_email_verification": True,
            },
            task_id=conversation_id,
        )

    return {"success": True}


@frappe.whitelist()
def reject_escalation_request(conversation_id, remarks=None):
    """
    Desk agent rejects a visitor's escalation request.
    The conversation returns to normal AI mode so the visitor can continue chatting.
    """
    user = frappe.session.user
    is_sysmanager = "System Manager" in frappe.get_roles(user)
    assignment = _get_human_assignment(user)
    if not assignment and not is_sysmanager:
        frappe.throw("No active escalation-enabled profile found for the current user.")

    conv_name = _get_conversation_name(conversation_id)
    if not conv_name:
        frappe.throw("Conversation not found.")

    esc_status = frappe.db.get_value("Nexus Live Conversation", conv_name, "escalation_status")
    if esc_status != "Requested":
        frappe.throw("No pending escalation request for this conversation.")

    # Reject all "Requested" escalation records for this conversation
    for esc_name in frappe.get_all(
        "Nexus Live Escalation",
        filters={"conversation": conv_name, "status": "Requested"},
        pluck="name",
    ):
        frappe.db.set_value(
            "Nexus Live Escalation",
            esc_name,
            {"status": "Rejected", "remarks": remarks or ""},
        )

    # Reset conversation — escalation_status = "Rejected", AI continues responding
    frappe.db.set_value("Nexus Live Conversation", conv_name, "escalation_status", "Rejected")
    frappe.db.commit()

    rejection_msg = (
        "Thank you for your patience! Our team has reviewed your request. "
        "Our AI assistant is ready to continue helping you — "
        "please feel free to ask any further questions."
    )

    conv = frappe.get_doc("Nexus Live Conversation", conv_name)
    add_message(
        conversation=conv,
        sender_type="AI Agent",
        message=rejection_msg,
        response_mode="chat",
    )

    publish_chat_response(conversation_id, {
        "status": "escalation_rejected",
        "response_type": "message",
        "message": rejection_msg,
        "answer": rejection_msg,
        "confidence": 1.0,
        "sources": [],
    })

    return {"success": True}
