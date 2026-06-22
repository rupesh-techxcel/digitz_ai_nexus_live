import frappe


@frappe.whitelist()
def get_live_studio_snapshot():
    return {
        "overview": get_overview_metrics(),
        "agents": get_workforce_agents(),
        "channels": get_channels(),
        "escalations": get_escalation_rules(),
    }


@frappe.whitelist()
def get_overview_metrics():
    ai_agents = frappe.db.count(
        "Nexus AI Agent Profile",
        {"enabled": 1},
    )

    human_agents = frappe.db.count(
        "Nexus User Profile Assignment",
        {"active": 1, "can_handle_escalations": 1},
    )

    channels = frappe.db.count(
        "Nexus Live Channel",
        {"enabled": 1},
    )

    escalation_rules = frappe.db.count(
        "Nexus Escalation Rule",
        {"enabled": 1},
    )

    return {
        "ai_agents": ai_agents,
        "human_agents": human_agents,
        "channels": channels,
        "escalation_rules": escalation_rules,
    }


@frappe.whitelist()
def get_workforce_agents():
    return frappe.get_all(
        "Nexus AI Agent Profile",
        filters={"enabled": 1},
        fields=[
            "name",
            "agent_code",
            "agent_name",
            "display_name",
            "agent_role",
            "status",
            "enabled",
            "visibility",
            "default_channel",
            "priority",
            "max_active_sessions",
            "current_active_sessions",
            "modified",
        ],
        order_by="priority asc, modified desc",
        limit_page_length=200,
    )


@frappe.whitelist()
def get_channels():
    return frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=[
            "name",
            "channel_name",
            "channel_code",
            "channel_type",
            "agent_based",
            "default_agent",
            "enabled",
        ],
        order_by="modified desc",
        limit_page_length=200,
    )


@frappe.whitelist()
def get_escalation_rules():
    return frappe.get_all(
        "Nexus Escalation Rule",
        filters={"enabled": 1},
        fields=[
            "name",
            "agent_role",
            "target_queue",
            "target_agent",
            "enabled",
            "modified",
        ],
        order_by="modified desc",
        limit_page_length=200,
    )
