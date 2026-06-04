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
        "Nexus Live Agent",
        {
            "enabled": 1,
            "agent_type": "AI",
        },
    )

    human_agents = frappe.db.count(
        "Nexus Live Agent",
        {
            "enabled": 1,
            "agent_type": "Human",
        },
    )

    channels = frappe.db.count(
        "Nexus Live Channel",
        {
            "enabled": 1,
        },
    )

    escalation_rules = frappe.db.count(
        "Nexus Escalation Rule",
        {
            "enabled": 1,
        },
    )

    approved_agents = frappe.db.count(
        "Nexus Agent Onboarding",
        {
            "onboarding_status": "Approved",
        },
    )

    return {
        "ai_agents": ai_agents,
        "human_agents": human_agents,
        "channels": channels,
        "escalation_rules": escalation_rules,
        "approved_agents": approved_agents,
    }


@frappe.whitelist()
def get_workforce_agents():
    fields = [
        "name",
        "agent_code",
        "agent_name",
        "display_name",
        "agent_type",
        "agent_role",
        "status",
        "enabled",
        "visibility",
        "default_channel",
        "priority",
        "max_active_sessions",
        "current_active_sessions",
        "modified",
    ]

    return frappe.get_all(
        "Nexus Live Agent",
        filters={
            "enabled": 1,
        },
        fields=fields,
        order_by="priority asc, modified desc",
        limit_page_length=200,
    )


@frappe.whitelist()
def get_channels():
    return frappe.get_all(
        "Nexus Live Channel",
        filters={
            "enabled": 1,
        },
        fields=[
            "name",
            "channel_name",
            "channel_code",
            "channel_type",
            "public_access",
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
        filters={
            "enabled": 1,
        },
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
