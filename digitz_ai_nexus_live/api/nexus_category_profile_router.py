import frappe

IDENTITY_TYPES = ["Public", "Customer", "Prospect", "Partner", "Internal", "Admin"]


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
    return {"channels": channels, "profiles": profiles, "identity_types": IDENTITY_TYPES}


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
        fields=["name", "identity_type", "ai_agent_profile", "enabled", "priority", "description"],
        order_by="priority asc",
    )

    configured_types = {r.identity_type for r in routes}
    available_types = [t for t in IDENTITY_TYPES if t not in configured_types]

    return {
        "routes": routes,
        "available_identity_types": available_types,
    }


@frappe.whitelist()
def save_route(channel, category_code, identity_type, ai_agent_profile, priority=10, description=None, name=None):
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
    profile_name = frappe.db.get_value(
        "Nexus Category Identity Route",
        {"channel": channel, "chat_category": category_code, "identity_type": identity_type, "enabled": 1},
        "ai_agent_profile",
        order_by="priority asc",
    )

    result = {
        "identity_type": identity_type,
        "profile": None,
        "access_categories": [],
        "policies": [],
        "warnings": [],
    }

    if not profile_name:
        result["warnings"].append(f"No enabled route for identity '{identity_type}'.")
        return result

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

    result["access_categories"] = cat_names

    policy_names = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": ["in", cat_names], "parentfield": "allowed_policies"},
        pluck="access_policy",
    )

    if policy_names:
        result["policies"] = frappe.get_all(
            "Nexus Access Policy",
            filters={"policy_name": ["in", list(set(policy_names))], "disabled": 0},
            fields=["policy_name", "is_primitive"],
            order_by="policy_name asc",
        )
    else:
        result["warnings"].append("Access categories exist but contain no policies.")

    return result
