import frappe

from digitz_ai_nexus_live.services.agent_service import (
    is_agent_available,
    increment_active_sessions,
)


def normalize_role(role):
    if not role:
        return None

    role = str(role).strip().lower()

    role_map = {
        "qa": "Public Responder",
        "q&a": "Public Responder",
        "q and a": "Public Responder",
        "question": "Public Responder",
        "public": "Public Responder",
        "public responder": "Public Responder",
        "sales": "Sales",
        "support": "Support",
        "consultant": "Consultant",
        "implementation": "Consultant",
        "internal": "Internal Assistant",
        "admin": "Admin Reviewer",
    }

    return role_map.get(role, role.title())


def detect_required_role(payload):
    payload = payload or {}

    if payload.get("agent_role"):
        return normalize_role(payload.get("agent_role"))

    conversation_type = payload.get("conversation_type")
    intent = payload.get("intent")
    query = payload.get("query") or payload.get("message") or ""

    text = f"{conversation_type or ''} {intent or ''} {query}".lower()

    if any(word in text for word in ["price", "pricing", "demo", "buy", "purchase", "sales", "quote"]):
        return "Sales"

    if any(word in text for word in ["error", "issue", "support", "problem", "not working", "ticket", "bug"]):
        return "Support"

    if any(word in text for word in ["implementation", "setup", "configure", "deployment", "install"]):
        return "Consultant"

    return "Public Responder"


def get_channel_name(channel_code_or_name=None):
    if not channel_code_or_name:
        return None

    if frappe.db.exists("Nexus Live Channel", channel_code_or_name):
        return channel_code_or_name

    return frappe.db.get_value(
        "Nexus Live Channel",
        {"channel_code": channel_code_or_name},
        "name",
    )


def get_channel_visibility(channel_name):
    if not channel_name:
        return None

    return frappe.db.get_value(
        "Nexus Live Channel",
        channel_name,
        "public_access",
    )


def find_available_agent(payload):
    """
    Find the best available approved idle agent for the incoming request.
    """
    payload = payload or {}

    required_role = detect_required_role(payload)
    requested_agent = payload.get("agent") or payload.get("agent_code")
    channel_name = get_channel_name(payload.get("channel"))
    visibility = payload.get("visibility") or "Public"

    filters = {
        "enabled": 1,
        "agent_type": "AI",
        "agent_role": required_role,
    }

    if requested_agent:
        if frappe.db.exists("Nexus Live Agent", requested_agent):
            filters["name"] = requested_agent
        else:
            filters["agent_code"] = requested_agent

    agents = frappe.get_all(
        "Nexus Live Agent",
        filters=filters,
        fields=[
            "name",
            "agent_code",
            "agent_name",
            "agent_type",
            "agent_role",
            "status",
            "enabled",
            "visibility",
            "default_channel",
            "priority",
            "max_active_sessions",
            "current_active_sessions",
        ],
        order_by="priority asc, modified desc",
        limit_page_length=50,
    )

    for row in agents:
        if row.visibility not in ("Both", visibility):
            continue

        if channel_name and row.default_channel and row.default_channel != channel_name:
            continue

        agent_doc = frappe.get_doc("Nexus Live Agent", row.name)

        if is_agent_available(agent_doc):
            return agent_doc

    return None


def assign_agent(payload, conversation=None):
    """
    Select and assign an available agent to a conversation.
    """
    agent = find_available_agent(payload)

    if not agent:
        return None

    agent = increment_active_sessions(agent, conversation=conversation)

    return agent


def get_default_agent_for_channel(channel_code_or_name):
    channel_name = get_channel_name(channel_code_or_name)

    if not channel_name:
        return None

    default_agent = frappe.db.get_value(
        "Nexus Live Channel",
        channel_name,
        "default_agent",
    )

    if not default_agent:
        return None

    agent = frappe.get_doc("Nexus Live Agent", default_agent)

    if is_agent_available(agent):
        return agent

    return None