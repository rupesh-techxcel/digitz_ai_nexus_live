import frappe
from frappe.utils import now_datetime


def get_agent(agent_code_or_name):
    """Load Nexus AI Agent Profile by agent_code (name) or document name."""
    if not agent_code_or_name:
        return None

    if frappe.db.exists("Nexus AI Agent Profile", agent_code_or_name):
        return frappe.get_doc("Nexus AI Agent Profile", agent_code_or_name)

    return None


def get_agent_behavior(agent):
    """
    Build the runtime behavior dict from a Nexus AI Agent Profile.
    The profile IS the agent — no secondary lookup needed.
    """
    if not agent:
        return None

    agent_doc = agent if hasattr(agent, "doctype") else get_agent(agent)

    if not agent_doc:
        return None

    return frappe._dict({
        "source": "Nexus AI Agent Profile",
        "profile_name": agent_doc.name,
        "behavior_prompt": agent_doc.behavior_prompt,
        "tone": agent_doc.tone,
        "response_style": agent_doc.response_style,
        "welcome_message": agent_doc.welcome_message,
        "fallback_message": agent_doc.fallback_message,
        "memory_mode": agent_doc.memory_mode,
        "confidence_threshold": agent_doc.confidence_threshold,
        "escalation_enabled": agent_doc.escalation_enabled,
        "escalation_policy": agent_doc.escalation_policy,
        "do_not_answer_rules": agent_doc.do_not_answer_rules,
        "knowledge_profile_name": agent_doc.knowledge_profile or "",
        "confidence_threshold_source": "Nexus AI Agent Profile",
    })


def is_agent_available(agent):
    """Check if the agent can receive a new conversation."""
    if not agent:
        return False

    if not agent.enabled:
        return False

    if agent.status not in ("Idle", "Waiting"):
        return False

    max_sessions = int(agent.max_active_sessions or 1)
    current_sessions = int(agent.current_active_sessions or 0)

    return current_sessions < max_sessions


def set_agent_status(agent, status, conversation=None, remarks=None):
    """Update agent status and write activity log."""
    if not agent:
        return

    agent_doc = agent if hasattr(agent, "doctype") else get_agent(agent)
    if not agent_doc:
        return

    previous_status = agent_doc.status
    agent_doc.status = status
    agent_doc.last_active_on = now_datetime()
    agent_doc.save(ignore_permissions=True)

    log_agent_activity(
        agent=agent_doc.name,
        event_type="Status Changed",
        previous_status=previous_status,
        new_status=status,
        conversation=conversation,
        remarks=remarks,
    )

    return agent_doc


def increment_active_sessions(agent, conversation=None):
    """Increase active session count when assigning a conversation."""
    agent_doc = agent if hasattr(agent, "doctype") else get_agent(agent)
    if not agent_doc:
        return

    current = int(agent_doc.current_active_sessions or 0)
    agent_doc.current_active_sessions = current + 1
    agent_doc.last_active_on = now_datetime()

    if agent_doc.status == "Idle":
        agent_doc.status = "Assigned"

    agent_doc.save(ignore_permissions=True)

    log_agent_activity(
        agent=agent_doc.name,
        event_type="Assigned",
        previous_status="Idle",
        new_status=agent_doc.status,
        conversation=conversation,
        remarks="Agent assigned to live conversation.",
    )

    return agent_doc


def decrement_active_sessions(agent, conversation=None):
    """Reduce active session count when conversation closes."""
    agent_doc = agent if hasattr(agent, "doctype") else get_agent(agent)
    if not agent_doc:
        return

    current = int(agent_doc.current_active_sessions or 0)
    agent_doc.current_active_sessions = max(current - 1, 0)

    if agent_doc.current_active_sessions == 0 and agent_doc.enabled:
        agent_doc.status = "Idle"

    agent_doc.last_active_on = now_datetime()
    agent_doc.save(ignore_permissions=True)

    log_agent_activity(
        agent=agent_doc.name,
        event_type="Closed",
        previous_status="Assigned",
        new_status=agent_doc.status,
        conversation=conversation,
        remarks="Conversation session released.",
    )

    return agent_doc


def log_agent_activity(
    agent,
    event_type,
    previous_status=None,
    new_status=None,
    conversation=None,
    remarks=None,
):
    """Create Nexus Agent Activity Log."""
    try:
        log = frappe.new_doc("Nexus Agent Activity Log")
        log.agent = agent
        log.event_type = event_type
        log.previous_status = previous_status
        log.new_status = new_status
        log.conversation = conversation
        log.remarks = remarks
        log.event_time = now_datetime()
        log.insert(ignore_permissions=True)
        return log.name

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Nexus AI Agent Profile Activity Log Failed",
        )
        return None
