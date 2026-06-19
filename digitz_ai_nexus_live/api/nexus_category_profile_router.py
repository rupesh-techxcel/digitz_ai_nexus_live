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
        fields=["name", "category_code", "category_label", "visibility", "enabled", "display_order"],
        order_by="display_order asc",
    )
    return {"categories": categories}


@frappe.whitelist()
def get_category_routes(channel, category_code):
    # category_code is actually the chat category doc name (e.g. NEXUS-PLATFORM-KNOW-HOW-DIGITZ-AI-NEXUS)
    category_channel, category_tenant = frappe.db.get_value(
        "Nexus Chat Category", category_code, ["channel", "tenant"]
    ) or (None, None)
    route_filters = {"channel": category_channel or channel, "chat_category": category_code}
    if category_tenant:
        route_filters["tenant"] = category_tenant
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters=route_filters,
        fields=["name", "ai_agent_profile", "enabled", "priority", "description"],
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
def create_identity_profile(profile_name, title=None, tenant=None, enabled=1):
    if not profile_name:
        frappe.throw("Profile Name is required.")
    if frappe.db.exists("Nexus Identity Profile", {"profile_name": profile_name}):
        frappe.throw(f"An Identity Profile named '{profile_name}' already exists.")
    doc = frappe.new_doc("Nexus Identity Profile")
    doc.profile_name = profile_name
    doc.title = title or profile_name
    doc.tenant = tenant or None
    doc.enabled = int(enabled)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success", "name": doc.name, "profile_name": doc.profile_name}


@frappe.whitelist()
def get_route(name):
    doc = frappe.get_doc("Nexus Category Identity Route", name)
    return {
        "name": doc.name,
        "channel": doc.channel,
        "chat_category": doc.chat_category,
        "ai_agent_profile": doc.ai_agent_profile,
        "enabled": doc.enabled,
        "published": doc.published,
        "priority": doc.priority or 10,
        "description": doc.description or "",
        "identity_profiles": [row.identity_profile for row in doc.identity_profiles or []],
    }


@frappe.whitelist()
def save_route(data):
    import json as _json
    if isinstance(data, str):
        data = _json.loads(data)

    name = data.get("name")
    if name and frappe.db.exists("Nexus Category Identity Route", name):
        doc = frappe.get_doc("Nexus Category Identity Route", name)
    else:
        doc = frappe.new_doc("Nexus Category Identity Route")

    doc.chat_category = data["chat_category"]
    category_channel = frappe.db.get_value("Nexus Chat Category", doc.chat_category, "channel")
    if not category_channel:
        frappe.throw("Selected chat category is not linked to a channel.")
    doc.channel = category_channel

    doc.ai_agent_profile = data.get("ai_agent_profile")
    doc.enabled = int(data.get("enabled", 1))
    doc.published = int(data.get("published", 1))
    doc.priority = int(data.get("priority") or 10)
    doc.description = data.get("description") or ""

    doc.set("identity_profiles", [])
    for ip in data.get("identity_profiles") or []:
        if ip:
            doc.append("identity_profiles", {"identity_profile": ip})

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
def get_route_chain(channel, category_code, route_name=None, identity_type=None):
    """
    Return the full access chain for a route:
    Route → Identity Profiles → Knowledge Profiles (per identity_type) → Access Categories → Policies
    """
    filters = {"channel": channel, "chat_category": category_code, "enabled": 1}
    if route_name:
        filters["name"] = route_name
    _cat_tenant = frappe.db.get_value("Nexus Chat Category", category_code, "tenant")
    if _cat_tenant:
        filters["tenant"] = _cat_tenant

    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters=filters,
        fields=["name", "ai_agent_profile"],
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
