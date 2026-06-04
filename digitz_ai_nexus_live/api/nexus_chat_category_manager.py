import frappe


@frappe.whitelist()
def get_category_chain(category_code):
    """
    Return all identity routes for a category, each with their full chain:
    Identity Type → Profile → Access Categories → Policies

    Since the same category can route to different profiles per identity type,
    this returns a list of route chains — one per configured identity type.
    """
    if not frappe.db.exists("Nexus Chat Category", category_code):
        frappe.throw(f"Category '{category_code}' not found.")

    cat = frappe.get_doc("Nexus Chat Category", category_code)

    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"chat_category": category_code, "enabled": 1},
        fields=["name", "identity_type", "ai_agent_profile", "priority"],
        order_by="priority asc",
    )

    result = {
            "category": {
                "code": cat.category_code,
                "label": cat.category_label,
                "requires_authentication": cat.requires_authentication,
                "identity_verification_mode": cat.identity_verification_mode,
                "allow_public_fallback": cat.allow_public_fallback,
                "enabled": cat.enabled,
            },
        "routes": [],
        "warnings": [],
    }

    if not routes:
        result["warnings"].append(
            "No identity routes configured. Visitors who select this category will "
            "receive an error. Add routes in the Category Profile Routes page."
        )
        return result

    for route in routes:
        entry = {
            "identity_type": route.identity_type,
            "profile": None,
            "access_categories": [],
            "policies": [],
            "warnings": [],
        }

        profile_name = route.ai_agent_profile
        if not profile_name or not frappe.db.exists("Nexus AI Agent Profile", profile_name):
            entry["warnings"].append(f"Profile '{profile_name}' not found.")
            result["routes"].append(entry)
            continue

        profile = frappe.get_doc("Nexus AI Agent Profile", profile_name)
        entry["profile"] = {
            "name": profile.name,
            "agent": profile.agent,
            "tone": profile.tone,
            "memory_mode": profile.memory_mode,
            "confidence_threshold": profile.confidence_threshold,
            "escalation_enabled": profile.escalation_enabled,
            "fallback_message": profile.fallback_message,
        }

        cat_names = frappe.get_all(
            "Nexus AI Agent Profile Access Category",
            filters={"ai_agent_profile": profile.name, "enabled": 1},
            pluck="access_category",
        )

        if not cat_names:
            entry["warnings"].append(f"Profile '{profile.name}' has no Access Category. Retrieval will be denied.")
            result["routes"].append(entry)
            continue

        entry["access_categories"] = cat_names

        policy_names = frappe.get_all(
            "Nexus Access Category Policy",
            filters={"parent": ["in", cat_names], "parentfield": "allowed_policies"},
            pluck="access_policy",
        )

        if policy_names:
            entry["policies"] = frappe.get_all(
                "Nexus Access Policy",
                filters={"policy_name": ["in", list(set(policy_names))], "disabled": 0},
                fields=["policy_name", "access_level", "sensitivity", "is_primitive"],
                order_by="policy_name asc",
            )
        else:
            entry["warnings"].append("Access categories exist but contain no policies.")

        result["routes"].append(entry)

    return result


@frappe.whitelist()
def get_page_data():
    channels = frappe.get_all(
        "Nexus Live Channel",
        filters={"enabled": 1},
        fields=["name", "channel_code", "channel_name", "channel_type"],
        order_by="channel_name asc",
    )
    return {"channels": channels}


@frappe.whitelist()
def get_channel_categories(channel):
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel},
        fields=[
            "name", "category_code", "category_label",
            "requires_authentication", "identity_verification_mode",
            "allow_public_fallback", "display_order", "enabled", "description",
        ],
        order_by="display_order asc",
    )

    # Annotate each category with its configured identity types (from routes)
    for cat in categories:
        cat["configured_identities"] = frappe.get_all(
            "Nexus Category Identity Route",
            filters={"chat_category": cat.category_code, "enabled": 1},
            pluck="identity_type",
            order_by="priority asc",
        )

    return {"categories": categories}


@frappe.whitelist()
def save_category(
    channel,
    category_label,
    display_order,
    description,
    enabled,
    requires_authentication=0,
    identity_verification_mode="None",
    allow_public_fallback=0,
    name=None,
    category_code=None,
):
    if name and frappe.db.exists("Nexus Chat Category", name):
        doc = frappe.get_doc("Nexus Chat Category", name)
    else:
        doc = frappe.new_doc("Nexus Chat Category")
        if category_code:
            doc.category_code = category_code
        else:
            slug = category_label.lower().replace(" ", "-").replace("/", "-")
            base = f"{channel}-{slug}"
            doc.category_code = base
            counter = 1
            while frappe.db.exists("Nexus Chat Category", doc.category_code):
                doc.category_code = f"{base}-{counter}"
                counter += 1

    doc.channel = channel
    doc.category_label = category_label
    doc.requires_authentication = int(requires_authentication or 0)
    doc.identity_verification_mode = identity_verification_mode or "None"
    doc.allow_public_fallback = int(allow_public_fallback or 0)
    doc.display_order = int(display_order or 10)
    doc.description = description or ""
    doc.enabled = int(enabled)

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name, "category_code": doc.category_code}


@frappe.whitelist()
def delete_category(name):
    if not frappe.db.exists("Nexus Chat Category", name):
        frappe.throw("Category not found.")

    cat = frappe.get_doc("Nexus Chat Category", name)

    # Remove all associated identity routes before deleting
    routes = frappe.get_all(
        "Nexus Category Identity Route",
        filters={"chat_category": cat.category_code},
        pluck="name",
    )
    for route in routes:
        frappe.delete_doc("Nexus Category Identity Route", route, ignore_permissions=True)

    frappe.delete_doc("Nexus Chat Category", name, ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def toggle_category(name, enabled):
    if not frappe.db.exists("Nexus Chat Category", name):
        frappe.throw("Category not found.")
    frappe.db.set_value("Nexus Chat Category", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}
