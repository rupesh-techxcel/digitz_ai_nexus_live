import frappe

from digitz_ai_nexus_live.services.identity_resolver import (
    get_enabled_identity_types,
    is_valid_identity_type,
)
from digitz_ai_nexus.engine.access_resolver import resolve_allowed_policies


@frappe.whitelist()
def get_page_data():
    channels = frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=["name", "channel_code", "channel_name", "channel_type"],
        order_by="channel_name asc",
    )
    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        fields=["name", "agent"],
        order_by="name asc",
    )
    return {
        "channels": channels,
        "profiles": profiles,
        "identity_types": get_enabled_identity_types(),
    }


@frappe.whitelist()
def get_channel_categories(channel):
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel},
        fields=["name", "category_code", "category_label", "requires_authentication", "enabled", "display_order"],
        order_by="display_order asc",
    )
    return {"categories": categories}


@frappe.whitelist()
def get_category_routes(channel, category_code):
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"channel": channel, "chat_category": category_code},
        fields=[
            "name",
            "identity_type",
            "ai_agent_profile",
            "enabled",
            "priority",
            "description",
        ],
        order_by="priority asc",
    )

    configured_types = {r.identity_type for r in routes}
    available_types = [
        identity_type
        for identity_type in get_enabled_identity_types()
        if identity_type not in configured_types
    ]

    return {
        "routes": routes,
        "available_identity_types": available_types,
    }


@frappe.whitelist()
def save_route(
    channel,
    category_code,
    identity_type,
    ai_agent_profile,
    priority=10,
    description=None,
    name=None,
):
    if not is_valid_identity_type(identity_type):
        frappe.throw(f"Identity Type '{identity_type}' is not enabled or does not exist.")

    if name and frappe.db.exists("Nexus Category Identity Route", name):
        doc = frappe.get_doc("Nexus Category Identity Route", name)
    else:
        existing = frappe.db.get_value(
            "Nexus Category Identity Route",
            {"channel": channel, "chat_category": category_code, "identity_type": identity_type},
            "name",
        )
        if existing:
            frappe.throw(
                f"A route for identity '{identity_type}' already exists for this category. Edit the existing route."
            )
        doc = frappe.new_doc("Nexus Category Identity Route")
        doc.channel = channel
        doc.chat_category = category_code
        doc.identity_type = identity_type

    doc.ai_agent_profile = ai_agent_profile
    doc.priority = int(priority or 10)
    doc.description = description or ""
    doc.enabled = 1
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def toggle_route(name, enabled):
    frappe.db.set_value("Nexus Category Identity Route", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def delete_route(name):
    frappe.delete_doc("Nexus Category Identity Route", name, ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def get_route_chain(channel, category_code, identity_type):
    """Return the full chain for one route: identity_type → profile → access → policies."""
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"channel": channel, "chat_category": category_code, "identity_type": identity_type, "enabled": 1},
        fields=["name", "ai_agent_profile"],
        order_by="priority asc",
        limit_page_length=1,
    )

    result = {
        "identity_type": identity_type,
        "route": None,
        "profile": None,
        "profile_access_categories": [],
        "access_categories": [],
        "profile_policies": [],
        "policies": [],
        "warnings": [],
    }

    if not routes:
        result["warnings"].append(f"No enabled route for identity '{identity_type}'.")
        return result

    route = routes[0]
    profile_name = route.ai_agent_profile
    result["route"] = route.name

    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)
    result["profile"] = {
        "name": profile.name,
        "agent": profile.agent,
        "tone": profile.tone,
        "confidence_threshold": profile.confidence_threshold,
        "escalation_enabled": profile.escalation_enabled,
    }

    cat_names = frappe.get_all(
        "Nexus AI Agent Profile Access Category",
        filters={"ai_agent_profile": profile_name, "enabled": 1},
        pluck="access_category",
    )

    if not cat_names:
        result["warnings"].append(f"Profile '{profile_name}' has no Access Category. Retrieval will be denied.")
        return result

    result["profile_access_categories"] = cat_names
    result["access_categories"] = cat_names

    policy_names = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": ["in", cat_names], "parentfield": "allowed_policies"},
        pluck="access_policy",
    )

    if policy_names:
        result["profile_policies"] = frappe.get_all(
            "Nexus Access Policy",
            filters={"policy_name": ["in", list(set(policy_names))], "disabled": 0},
            fields=["policy_name", "is_primitive"],
            order_by="policy_name asc",
        )
    else:
        result["warnings"].append("Access categories exist but contain no policies.")

    access_resolution = resolve_allowed_policies({
        "ai_profile": {
            "name": profile_name,
            "identity_type": identity_type,
        },
        "identity_type": identity_type,
    })

    allowed_policy_names = access_resolution.get("allowed_access_policies") or []
    if allowed_policy_names:
        result["policies"] = frappe.get_all(
            "Nexus Access Policy",
            filters={"policy_name": ["in", allowed_policy_names], "disabled": 0},
            fields=["policy_name", "is_primitive"],
            order_by="policy_name asc",
        )
    else:
        result["warnings"].append(
            "Effective policy set is empty after applying identity cap. Retrieval will be denied."
        )

    result["access_resolution"] = access_resolution

    return result
