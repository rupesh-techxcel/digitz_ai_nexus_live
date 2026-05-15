import frappe


def doctype_exists(doctype):
    return bool(frappe.db.exists("DocType", doctype))


def field_exists(doctype, fieldname):
    if not doctype_exists(doctype):
        return False

    return frappe.get_meta(doctype).has_field(fieldname)


@frappe.whitelist()
def get_live_studio_snapshot():
    return {
        "overview": get_overview_metrics(),
        "agents": get_workforce_agents(),
        "behaviours": get_behaviour_profiles(),
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

    behaviours = (
        frappe.db.count(
            "Nexus AI Behaviour",
            {
                "enabled": 1,
            },
        )
        if doctype_exists("Nexus AI Behaviour")
        else 0
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
        "behaviours": behaviours,
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

    if field_exists("Nexus Live Agent", "behaviour"):
        fields.append("behaviour")

    agents = frappe.get_all(
        "Nexus Live Agent",
        filters={
            "enabled": 1,
        },
        fields=fields,
        order_by="priority asc, modified desc",
        limit_page_length=200,
    )

    for agent in agents:
        agent["behaviour_name"] = None
        agent["behaviour_code"] = None
        agent["behaviour_designation"] = None
        agent["behaviour_tone"] = None
        agent["behaviour_response_style"] = None
        agent["behaviour_memory_mode"] = None
        agent["behaviour_escalation_enabled"] = None
        agent["behaviour_confidence_threshold"] = None

        behaviour = agent.get("behaviour")

        if behaviour and doctype_exists("Nexus AI Behaviour"):
            behaviour_doc = frappe.db.get_value(
                "Nexus AI Behaviour",
                behaviour,
                [
                    "behaviour_code",
                    "behaviour_name",
                    "designation",
                    "tone",
                    "response_style",
                    "memory_mode",
                    "escalation_enabled",
                    "confidence_threshold",
                ],
                as_dict=True,
            )

            if behaviour_doc:
                agent["behaviour_code"] = behaviour_doc.get("behaviour_code")
                agent["behaviour_name"] = behaviour_doc.get("behaviour_name")
                agent["behaviour_designation"] = behaviour_doc.get("designation")
                agent["behaviour_tone"] = behaviour_doc.get("tone")
                agent["behaviour_response_style"] = behaviour_doc.get("response_style")
                agent["behaviour_memory_mode"] = behaviour_doc.get("memory_mode")
                agent["behaviour_escalation_enabled"] = behaviour_doc.get("escalation_enabled")
                agent["behaviour_confidence_threshold"] = behaviour_doc.get("confidence_threshold")

    return agents


@frappe.whitelist()
def get_behaviour_profiles():
    """
    Behaviour Masters for the Studio.
    This intentionally uses Nexus AI Behaviour, not Nexus AI Agent Profile,
    because behaviours are reusable master definitions.
    """
    if not doctype_exists("Nexus AI Behaviour"):
        return []

    fields = [
        "name",
        "behaviour_code",
        "behaviour_name",
        "designation",
        "enabled",
        "tone",
        "response_style",
        "memory_mode",
        "confidence_threshold",
        "escalation_enabled",
        "modified",
    ]

    fields = [
        field for field in fields
        if field == "name" or field_exists("Nexus AI Behaviour", field)
    ]

    return frappe.get_all(
        "Nexus AI Behaviour",
        filters={
            "enabled": 1,
        },
        fields=fields,
        order_by="modified desc",
        limit_page_length=200,
    )


@frappe.whitelist()
def get_behaviour_options():
    if not doctype_exists("Nexus AI Behaviour"):
        return []

    fields = [
        "name",
        "behaviour_code",
        "behaviour_name",
        "designation",
        "tone",
        "response_style",
    ]

    fields = [
        field for field in fields
        if field == "name" or field_exists("Nexus AI Behaviour", field)
    ]

    return frappe.get_all(
        "Nexus AI Behaviour",
        filters={
            "enabled": 1,
        },
        fields=fields,
        order_by="behaviour_name asc",
        limit_page_length=500,
    )


@frappe.whitelist()
def assign_behaviour_to_agent(agent, behaviour):
    if not agent:
        frappe.throw("Agent is required.")

    if not behaviour:
        frappe.throw("Behaviour is required.")

    if not doctype_exists("Nexus AI Behaviour"):
        frappe.throw("Nexus AI Behaviour DocType is not available.")

    if not field_exists("Nexus Live Agent", "behaviour"):
        frappe.throw("Field 'behaviour' is missing in Nexus Live Agent.")

    if not frappe.db.exists("Nexus Live Agent", agent):
        frappe.throw("Nexus Live Agent not found.")

    if not frappe.db.exists("Nexus AI Behaviour", behaviour):
        frappe.throw("Nexus AI Behaviour not found.")

    agent_doc = frappe.get_doc("Nexus Live Agent", agent)

    if agent_doc.agent_type != "AI":
        frappe.throw("Behaviour can be assigned only to AI agents.")

    agent_doc.behaviour = behaviour
    agent_doc.save(ignore_permissions=True)

    update_onboarding_behaviour_status(agent_doc.name)

    frappe.db.commit()

    return {
        "status": "success",
        "agent": agent_doc.name,
        "behaviour": behaviour,
    }


def update_onboarding_behaviour_status(agent):
    onboarding_name = frappe.db.get_value(
        "Nexus Agent Onboarding",
        {
            "agent": agent,
        },
        "name",
    )

    if not onboarding_name:
        return

    onboarding = frappe.get_doc("Nexus Agent Onboarding", onboarding_name)

    if field_exists("Nexus Agent Onboarding", "behavior_completed"):
        onboarding.behavior_completed = 1

    if field_exists("Nexus Agent Onboarding", "behaviour_completed"):
        onboarding.behaviour_completed = 1

    onboarding.save(ignore_permissions=True)


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