import json
import frappe


@frappe.whitelist()
def get_page_data():
    from digitz_ai_nexus_live.api.nexus_profile_access_allocation import get_available_tenants

    tenant_data = get_available_tenants()

    channels = frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=["name", "channel_code", "channel_name"],
        order_by="channel_name asc",
    )

    escalation_policies = frappe.get_all(
        "Nexus Escalation Rule",
        fields=["name"],
        order_by="name asc",
    )

    return {
        "tenants": tenant_data.get("tenants") or [],
        "default_tenant": tenant_data.get("default_tenant") or "",
        "channels": channels,
        "escalation_policies": [p.name for p in escalation_policies],
        "agent_roles": [
            "Public Responder", "Sales", "Support", "Consultant",
            "Internal Assistant", "Admin Reviewer",
        ],
        "visibility_options": ["Public", "Internal", "Both"],
        "status_options": ["Idle", "Assigned", "Responding", "Waiting", "Unavailable", "Disabled"],
        "response_modes": ["qa", "chat"],
        "memory_modes": ["None", "Session", "Conversation Summary", "Long Term"],
    }


@frappe.whitelist()
def get_profiles(tenant=None):
    filters = {}
    if tenant:
        filters["tenant"] = tenant

    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        filters=filters,
        fields=[
            "name", "agent_code", "agent_name", "display_name",
            "agent_role", "visibility", "status", "enabled",
            "tenant", "priority", "description",
        ],
        order_by="agent_name asc",
    )

    return {"profiles": profiles}


@frappe.whitelist()
def get_profile(name):
    doc = frappe.get_doc("Nexus AI Agent Profile", name)

    return {
        "profile": {
            "name": doc.name,
            "agent_code": doc.agent_code or "",
            "agent_name": doc.agent_name or "",
            "display_name": doc.display_name or "",
            "nickname_pool": doc.nickname_pool or "",
            "tenant": doc.tenant or "",
            "agent_role": doc.agent_role or "",
            "visibility": doc.visibility or "",
            "enabled": doc.enabled,
            "status": doc.status or "Idle",
            "priority": doc.priority or 0,
            "max_active_sessions": doc.max_active_sessions or 0,
            "default_channel": doc.default_channel or "",
            "description": doc.description or "",
            "behavior_prompt": doc.behavior_prompt or "",
            "tone": doc.tone or "",
            "response_style": doc.response_style or "",
            "welcome_message": doc.welcome_message or "",
            "fallback_message": doc.fallback_message or "",
            "do_not_answer_rules": doc.do_not_answer_rules or "",
            "default_response_mode": doc.default_response_mode or "",
            "confidence_threshold": doc.confidence_threshold or 0,
            "escalation_enabled": doc.escalation_enabled,
            "escalation_policy": doc.escalation_policy or "",
            "memory_mode": doc.memory_mode or "None",
        }
    }


@frappe.whitelist()
def save_profile(profile):
    data = json.loads(profile or "{}")

    name = data.get("name")
    if name and frappe.db.exists("Nexus AI Agent Profile", name):
        doc = frappe.get_doc("Nexus AI Agent Profile", name)
    else:
        doc = frappe.new_doc("Nexus AI Agent Profile")

    doc.agent_code = (data.get("agent_code") or "").strip().upper().replace(" ", "-")
    doc.agent_name = (data.get("agent_name") or "").strip()
    doc.display_name = (data.get("display_name") or "").strip()
    doc.nickname_pool = (data.get("nickname_pool") or "").strip()
    doc.tenant = data.get("tenant") or ""
    doc.agent_role = data.get("agent_role") or ""
    doc.visibility = data.get("visibility") or "Public"
    doc.enabled = int(data.get("enabled") or 0)
    doc.status = data.get("status") or "Idle"
    doc.priority = int(data.get("priority") or 0)
    doc.max_active_sessions = int(data.get("max_active_sessions") or 0)
    doc.default_channel = data.get("default_channel") or ""
    doc.description = (data.get("description") or "").strip()
    doc.behavior_prompt = (data.get("behavior_prompt") or "").strip()
    doc.tone = (data.get("tone") or "").strip()
    doc.response_style = (data.get("response_style") or "").strip()
    doc.welcome_message = (data.get("welcome_message") or "").strip()
    doc.fallback_message = (data.get("fallback_message") or "").strip()
    doc.do_not_answer_rules = (data.get("do_not_answer_rules") or "").strip()
    doc.default_response_mode = data.get("default_response_mode") or ""
    doc.confidence_threshold = float(data.get("confidence_threshold") or 0)
    doc.escalation_enabled = int(data.get("escalation_enabled") or 0)
    doc.escalation_policy = data.get("escalation_policy") or ""
    doc.memory_mode = data.get("memory_mode") or "None"

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def delete_profile(name):
    if not frappe.db.exists("Nexus AI Agent Profile", name):
        frappe.throw("Profile not found.")
    frappe.delete_doc("Nexus AI Agent Profile", name, ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def toggle_profile(name, enabled):
    if not frappe.db.exists("Nexus AI Agent Profile", name):
        frappe.throw("Profile not found.")
    frappe.db.set_value("Nexus AI Agent Profile", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}
