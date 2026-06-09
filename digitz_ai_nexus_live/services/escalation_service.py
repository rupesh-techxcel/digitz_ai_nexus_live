import frappe
from frappe.utils import now_datetime

from digitz_ai_nexus_live.services.conversation_service import (
    mark_escalated,
)

from digitz_ai_nexus_live.services.agent_service import (
    set_agent_status,
)


DEFAULT_CONFIDENCE_THRESHOLD = 0.65


def should_escalate(
    confidence=None,
    no_knowledge=False,
    user_requested_human=False,
    repeated_fallback=False,
    escalation_enabled=True,
    threshold=None,
):
    """Determine whether escalation is required."""
    if not escalation_enabled:
        return False

    threshold = threshold or DEFAULT_CONFIDENCE_THRESHOLD

    if user_requested_human:
        return True

    if no_knowledge:
        return True

    if repeated_fallback:
        return True

    if confidence is not None and float(confidence) < float(threshold):
        return True

    return False


def get_escalation_rule(agent_role):
    """Load escalation rule by agent role."""
    if not agent_role:
        return None

    rule_name = frappe.db.get_value(
        "Nexus Escalation Rule",
        {"enabled": 1, "agent_role": agent_role},
        "name",
    )

    if not rule_name:
        return None

    return frappe.get_doc("Nexus Escalation Rule", rule_name)


def get_queue_agents(queue_name):
    """Return enabled AI agent profiles assigned to a queue."""
    if not queue_name:
        return []

    assignments = frappe.get_all(
        "Nexus Queue Assignment",
        filters={"queue": queue_name, "enabled": 1},
        fields=["agent", "priority"],
        order_by="priority asc",
    )

    agents = []
    for row in assignments:
        if not row.agent:
            continue

        if not frappe.db.exists("Nexus AI Agent Profile", row.agent):
            continue

        agent = frappe.get_doc("Nexus AI Agent Profile", row.agent)

        if not agent.enabled:
            continue

        agents.append(agent)

    return agents


def find_escalation_target(rule):
    """Find escalation target from rule."""
    if not rule:
        return {"agent": None, "queue": None}

    if rule.target_agent:
        if frappe.db.exists("Nexus AI Agent Profile", rule.target_agent):
            return {
                "agent": frappe.get_doc("Nexus AI Agent Profile", rule.target_agent),
                "queue": None,
            }

    if rule.target_queue:
        agents = get_queue_agents(rule.target_queue)

        if agents:
            return {"agent": agents[0], "queue": rule.target_queue}

        return {"agent": None, "queue": rule.target_queue}

    return {"agent": None, "queue": None}


def create_escalation(
    conversation,
    reason,
    from_agent=None,
    confidence=None,
    remarks=None,
):
    """Create Nexus Live Escalation record."""
    conversation_doc = (
        conversation
        if hasattr(conversation, "doctype")
        else frappe.get_doc("Nexus Live Conversation", conversation)
    )

    from_agent_doc = None

    if from_agent:
        from_agent_doc = (
            from_agent
            if hasattr(from_agent, "doctype")
            else frappe.get_doc("Nexus AI Agent Profile", from_agent)
        )

    agent_role = from_agent_doc.agent_role if from_agent_doc else None
    rule = get_escalation_rule(agent_role)
    target = find_escalation_target(rule)

    escalation = frappe.new_doc("Nexus Live Escalation")
    escalation.conversation = conversation_doc.name
    escalation.escalation_reason = reason
    escalation.from_agent = from_agent_doc.name if from_agent_doc else None
    escalation.to_agent = target["agent"].name if target["agent"] else None
    escalation.to_queue = target["queue"]
    escalation.status = "Pending"
    escalation.confidence = confidence
    escalation.remarks = remarks
    escalation.created_on = now_datetime()

    escalation.insert(ignore_permissions=True)

    mark_escalated(conversation_doc)

    if from_agent_doc:
        set_agent_status(
            from_agent_doc,
            "Waiting",
            conversation=conversation_doc.name,
            remarks="Conversation escalated.",
        )

    try:
        from digitz_ai_nexus_live.services.chat_realtime import publish_escalation_alert
        fresh_conv = frappe.get_doc("Nexus Live Conversation", conversation_doc.name)
        publish_escalation_alert(fresh_conv)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Nexus Escalation Alert Failed")

    return escalation


def resolve_escalation(escalation, remarks=None):
    """Resolve escalation workflow."""
    escalation_doc = (
        escalation
        if hasattr(escalation, "doctype")
        else frappe.get_doc("Nexus Live Escalation", escalation)
    )

    escalation_doc.status = "Resolved"
    escalation_doc.remarks = remarks or escalation_doc.remarks
    escalation_doc.resolved_on = now_datetime()
    escalation_doc.save(ignore_permissions=True)

    return escalation_doc


def reject_escalation(escalation, remarks=None):
    """Reject escalation workflow."""
    escalation_doc = (
        escalation
        if hasattr(escalation, "doctype")
        else frappe.get_doc("Nexus Live Escalation", escalation)
    )

    escalation_doc.status = "Rejected"
    escalation_doc.remarks = remarks or escalation_doc.remarks
    escalation_doc.save(ignore_permissions=True)

    return escalation_doc
