import frappe
from frappe.utils import now_datetime


def get_agent(agent_code_or_name):
    """
    Load Nexus Live Agent by agent_code or document name.
    """
    if not agent_code_or_name:
        return None

    if frappe.db.exists("Nexus Live Agent", agent_code_or_name):
        return frappe.get_doc("Nexus Live Agent", agent_code_or_name)

    agent_name = frappe.db.get_value(
        "Nexus Live Agent",
        {"agent_code": agent_code_or_name},
        "name",
    )

    if agent_name:
        return frappe.get_doc("Nexus Live Agent", agent_name)

    return None


def get_ai_profile(agent):
    """
    Load AI profile for a Nexus Live Agent.
    """
    if not agent:
        return None

    agent_name = agent.name if hasattr(agent, "name") else agent

    profile_name = frappe.db.get_value(
        "Nexus AI Agent Profile",
        {"agent": agent_name},
        "name",
    )

    if not profile_name:
        return None

    return frappe.get_doc("Nexus AI Agent Profile", profile_name)

def get_agent_behavior(agent):
    """
    Runtime behaviour resolver for AI agents.

    Nexus AI Agent Profile is the only runtime behaviour source.
    """
    if not agent:
        return None

    agent_doc = agent if hasattr(agent, "doctype") else frappe.get_doc("Nexus Live Agent", agent)

    if agent_doc.agent_type != "AI":
        return None

    profile = get_ai_profile(agent_doc)

    if not profile:
        return None

    return frappe._dict({
        "source": "Nexus AI Agent Profile",
        "profile_name": profile.name,
        "behavior_prompt": profile.behavior_prompt,
        "tone": profile.tone,
        "response_style": profile.response_style,
        "welcome_message": profile.welcome_message,
        "fallback_message": profile.fallback_message,
        "memory_mode": profile.memory_mode,
        "confidence_threshold": profile.confidence_threshold,
        "escalation_enabled": profile.escalation_enabled,
        "escalation_policy": profile.escalation_policy,
        "do_not_answer_rules": profile.do_not_answer_rules,
        "confidence_threshold_source": "Nexus AI Agent Profile",
    })

def get_human_profile(agent):
    """
    Load Human profile for a Nexus Live Agent.
    """
    if not agent:
        return None

    agent_name = agent.name if hasattr(agent, "name") else agent

    profile_name = frappe.db.get_value(
        "Nexus Human Agent Profile",
        {"agent": agent_name},
        "name",
    )

    if not profile_name:
        return None

    return frappe.get_doc("Nexus Human Agent Profile", profile_name)


def get_onboarding(agent):
    """
    Load onboarding record for a Nexus Live Agent.
    """
    if not agent:
        return None

    agent_name = agent.name if hasattr(agent, "name") else agent

    onboarding_name = frappe.db.get_value(
        "Nexus Agent Onboarding",
        {"agent": agent_name},
        "name",
    )

    if not onboarding_name:
        return None

    return frappe.get_doc("Nexus Agent Onboarding", onboarding_name)


def is_onboarding_approved(agent):
    """
    An agent can respond only after onboarding is approved.
    """
    onboarding = get_onboarding(agent)

    if not onboarding:
        return False

    return onboarding.onboarding_status == "Approved"


def is_agent_available(agent):
    """
    Check if the agent can receive a new conversation.
    """
    if not agent:
        return False

    if not agent.enabled:
        return False

    if agent.status not in ("Idle", "Waiting"):
        return False

    if not is_onboarding_approved(agent):
        return False

    max_sessions = int(agent.max_active_sessions or 1)
    current_sessions = int(agent.current_active_sessions or 0)

    return current_sessions < max_sessions


def set_agent_status(agent, status, conversation=None, remarks=None):
    """
    Update agent status and write activity log.
    """
    if not agent:
        return

    agent_doc = agent if hasattr(agent, "doctype") else frappe.get_doc("Nexus Live Agent", agent)

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
    """
    Increase active session count when assigning a conversation.
    """
    agent_doc = agent if hasattr(agent, "doctype") else frappe.get_doc("Nexus Live Agent", agent)

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
    """
    Reduce active session count when conversation closes or handover completes.
    """
    agent_doc = agent if hasattr(agent, "doctype") else frappe.get_doc("Nexus Live Agent", agent)

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
    """
    Create Nexus Agent Activity Log.
    """
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
            "Nexus Live Agent Activity Log Failed",
        )
        return None
