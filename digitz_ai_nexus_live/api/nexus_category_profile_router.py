import frappe

from digitz_ai_nexus_live.services.identity_resolver import (
    get_enabled_identity_types,
)
from digitz_ai_nexus.engine.access_resolver import resolve_allowed_policies


@frappe.whitelist()
def get_page_data(tenant=None):
    channel_filters = {"enabled": 1}
    if tenant:
        channel_filters["tenant"] = tenant

    channels = frappe.get_all(
        "Nexus Live Channel",
        filters=channel_filters,
        fields=["name", "channel_code", "channel_name", "channel_type"],
        order_by="channel_name asc",
    )
    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        fields=["name", "agent_name"],
        order_by="name asc",
    )
    identity_profiles = frappe.get_all(
        "Nexus Identity Profile",
        filters={"enabled": 1},
        fields=["name", "profile_name", "title"],
        order_by="profile_name asc",
    )
    return {
        "channels": channels,
        "profiles": profiles,
        "identity_profiles": identity_profiles,
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
    # category_code is actually the chat category doc name (e.g. NEXUS-PLATFORM-KNOW-HOW-DIGITZ-AI-NEXUS)
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"channel": channel, "chat_category": category_code},
        fields=["name", "ai_agent_profile", "is_public_route", "enabled", "priority", "description"],
        order_by="priority asc",
    )

    for route in routes:
        route["identity_profiles"] = frappe.get_all(
            "Nexus Route Identity Profile",
            filters={"parent": route.name},
            pluck="identity_profile",
        )

    return {"routes": routes}


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
def get_route_chain(channel, category_code, route_name=None, identity_type=None):
    """
    Return the full access chain for a route:
    Route → Identity Profiles → Knowledge Profiles (per identity_type) → Access Categories → Policies
    """
    filters = {"channel": channel, "chat_category": category_code, "enabled": 1}
    if route_name:
        filters["name"] = route_name

    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters=filters,
        fields=["name", "ai_agent_profile", "is_public_route"],
        order_by="priority asc",
        limit_page_length=1,
    )

    result = {
        "route": None,
        "profile": None,
        "identity_profiles": [],
        "knowledge_profiles": [],
        "access_categories": [],
        "policies": [],
        "warnings": [],
    }

    if not routes:
        result["warnings"].append("No enabled route found.")
        return result

    route = routes[0]
    profile_name = route.ai_agent_profile
    result["route"] = route.name

    profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)
    result["profile"] = {
        "name": profile.name,
        "agent": profile.agent_name,
        "tone": profile.tone,
        "confidence_threshold": profile.confidence_threshold,
        "escalation_enabled": profile.escalation_enabled,
    }

    if route.is_public_route:
        result["warnings"].append("This is a public route — knowledge access is Public only.")
        access_resolution = resolve_allowed_policies({
            "force_public_only": True,
            "ai_profile": {"name": profile_name},
        })
        result["access_resolution"] = access_resolution
        result["policies"] = [{"policy_name": "Public"}]
        return result

    route_profile_names = frappe.get_all(
        "Nexus Route Identity Profile",
        filters={"parent": route.name},
        pluck="identity_profile",
    )
    result["identity_profiles"] = route_profile_names

    if not route_profile_names:
        result["warnings"].append("No Identity Profiles assigned to this route.")
        return result

    if not identity_type:
        result["warnings"].append(
            "Pass identity_type to see knowledge profiles and effective policies."
        )
        return result

    knowledge_profile_names = []
    for ip_name in route_profile_names:
        if not frappe.db.exists("Nexus Identity Profile", ip_name):
            continue
        ip_doc = frappe.get_doc("Nexus Identity Profile", ip_name)
        if not ip_doc.enabled:
            continue
        for row in ip_doc.identity_mappings or []:
            if row.identity_type == identity_type and row.knowledge_profile:
                knowledge_profile_names.append(row.knowledge_profile)

    knowledge_profile_names = list(set(knowledge_profile_names))
    result["knowledge_profiles"] = knowledge_profile_names

    if not knowledge_profile_names:
        result["warnings"].append(
            f"No Knowledge Profiles mapped to identity_type '{identity_type}' "
            "via this route's Identity Profiles."
        )
        return result

    category_names = []
    for kp_name in knowledge_profile_names:
        cats = frappe.get_all(
            "Knowledge Profile Access Category",
            filters={"parent": kp_name, "parentfield": "access_categories", "enabled": 1},
            pluck="access_category",
        )
        category_names.extend(cats)
    category_names = list(set(category_names))
    result["access_categories"] = category_names

    if not category_names:
        result["warnings"].append("No enabled Access Categories in the resolved Knowledge Profiles.")

    safeguard_cats = frappe.get_all(
        "Nexus Identity Type Safe Guard Category",
        filters={"parent": identity_type, "parentfield": "safeguard_access_categories"},
        pluck="access_category",
    )

    access_resolution = resolve_allowed_policies({
        "ai_profile": {
            "name": profile_name,
            "knowledge_profile_names": knowledge_profile_names,
            "identity_type": identity_type,
            "identity_safeguard_access_categories": safeguard_cats or None,
        },
        "identity_type": identity_type,
    })

    allowed_policy_names = access_resolution.get("allowed_access_policies") or []
    if allowed_policy_names:
        result["policies"] = frappe.get_all(
            "Nexus Access Policy",
            filters={"name": ["in", allowed_policy_names], "disabled": 0},
            fields=["name", "is_primitive"],
            order_by="name asc",
        )
    else:
        result["warnings"].append(
            "Effective policy set is empty after applying identity cap. Retrieval will be denied."
        )

    result["access_resolution"] = access_resolution

    return result
