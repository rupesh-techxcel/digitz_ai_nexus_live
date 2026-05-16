import frappe

from digitz_ai_nexus_live.services.agent_service import (
    is_agent_available,
    increment_active_sessions,
)

from digitz_ai_nexus.services.tenant_context import resolve_tenant_context


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


def get_requested_agent(payload):
    payload = payload or {}
    return payload.get("agent") or payload.get("agent_code")


def get_agent_by_code_or_name(agent_code_or_name):
    if not agent_code_or_name:
        return None

    if frappe.db.exists("Nexus Live Agent", agent_code_or_name):
        return frappe.get_doc("Nexus Live Agent", agent_code_or_name)

    agent_name = frappe.db.get_value(
        "Nexus Live Agent",
        {
            "agent_code": agent_code_or_name
        },
        "name",
    )

    if not agent_name:
        return None

    return frappe.get_doc("Nexus Live Agent", agent_name)


def agent_matches_channel(agent_doc, channel_name=None):
    if not agent_doc:
        return False

    if not channel_name:
        return True

    if not getattr(agent_doc, "default_channel", None):
        return True

    return agent_doc.default_channel == channel_name


def agent_matches_visibility(agent_doc, visibility="Public"):
    if not agent_doc:
        return False

    agent_visibility = getattr(agent_doc, "visibility", None)

    if not agent_visibility:
        return True

    return agent_visibility in ("Both", visibility)


def agent_matches_role(agent_doc, required_role=None):
    if not agent_doc:
        return False

    if not required_role:
        return True

    return getattr(agent_doc, "agent_role", None) == required_role


def get_available_specific_agent(
    agent_code_or_name,
    channel_name=None,
    visibility="Public",
    required_role=None,
    enforce_role=False,
):
    """
    Returns a specific agent only if it is usable for the current request.

    Used for:
    - explicit payload agent
    - ecosystem default_public_agent
    - channel default_agent
    """
    agent = get_agent_by_code_or_name(agent_code_or_name)

    if not agent:
        return None

    if getattr(agent, "enabled", 0) != 1:
        return None

    if getattr(agent, "agent_type", None) != "AI":
        return None

    if enforce_role and not agent_matches_role(agent, required_role):
        return None

    if not agent_matches_visibility(agent, visibility):
        return None

    if not agent_matches_channel(agent, channel_name):
        return None

    if not is_agent_available(agent):
        return None

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

    return get_available_specific_agent(
        agent_code_or_name=default_agent,
        channel_name=channel_name,
        visibility="Public",
        required_role=None,
        enforce_role=False,
    )


def get_ecosystem_default_public_agent(payload):
    """
    Returns the tenant ecosystem default public agent if configured.

    Important:
    Do not resolve implicit user context here unless the payload already carries
    tenant context. This avoids low-level router tests and internal calls being
    affected by the current user's active tenant.

    Expected caller behaviour:
    - live_chat_service.py enriches payload first using apply_tenant_context_to_payload()
    - then agent_router can safely use _resolved_tenant_context / tenant
    """
    payload = payload or {}

    resolved_context = payload.get("_resolved_tenant_context") or {}

    if resolved_context.get("ecosystem"):
        try:
            resolved = resolve_tenant_context(
                payload=payload,
                require_tenant=False,
            )
            return resolved.default_public_agent if resolved else None
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                "Nexus Agent Router Tenant Context Resolution Failed",
            )
            return None

    if not payload.get("tenant"):
        return None

    try:
        resolved = resolve_tenant_context(
            payload=payload,
            require_tenant=False,
        )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Nexus Agent Router Tenant Context Resolution Failed",
        )
        return None

    return resolved.default_public_agent if resolved else None

def find_available_agent(payload):
    """
    Find the best available approved idle agent for the incoming request.

    Priority:
    1. Explicit agent from payload
       - if requested but unavailable, return None
    2. Ecosystem default_public_agent
       - only when payload is tenant-enriched or explicitly carries tenant
    3. Channel default_agent
    4. Role/intent-based routing fallback
    """
    payload = payload or {}

    required_role = detect_required_role(payload)
    requested_agent = get_requested_agent(payload)
    channel_name = get_channel_name(payload.get("channel"))
    visibility = payload.get("visibility") or "Public"

    # ---------------------------------------------------------------------
    # 1. Explicit requested agent
    # ---------------------------------------------------------------------
    if requested_agent:
        return get_available_specific_agent(
            agent_code_or_name=requested_agent,
            channel_name=channel_name,
            visibility=visibility,
            required_role=required_role,
            enforce_role=False,
        )

    # ---------------------------------------------------------------------
    # 2. Tenant ecosystem default public agent
    # ---------------------------------------------------------------------
    ecosystem_default_agent = get_ecosystem_default_public_agent(payload)

    if ecosystem_default_agent:
        agent = get_available_specific_agent(
            agent_code_or_name=ecosystem_default_agent,
            channel_name=channel_name,
            visibility=visibility,
            required_role=required_role,
            enforce_role=False,
        )

        if agent:
            return agent

    # ---------------------------------------------------------------------
    # 3. Channel default agent
    # ---------------------------------------------------------------------
    if channel_name:
        channel_default_agent = frappe.db.get_value(
            "Nexus Live Channel",
            channel_name,
            "default_agent",
        )

        if channel_default_agent:
            agent = get_available_specific_agent(
                agent_code_or_name=channel_default_agent,
                channel_name=channel_name,
                visibility=visibility,
                required_role=required_role,
                enforce_role=False,
            )

            if agent:
                return agent

    # ---------------------------------------------------------------------
    # 4. Role/intent-based routing fallback
    # ---------------------------------------------------------------------
    filters = {
        "enabled": 1,
        "agent_type": "AI",
        "agent_role": required_role,
    }

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