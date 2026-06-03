import frappe


@frappe.whitelist()
def get_page_data():
    profiles = frappe.get_all(
        "Nexus AI Agent Profile",
        fields=["name", "agent", "behavior_prompt", "tone", "memory_mode"],
        order_by="name asc",
    )

    categories = frappe.get_all(
        "Nexus Access Category",
        filters={"disabled": 0},
        fields=["name", "category_name", "title", "description", "priority"],
        order_by="priority asc",
    )

    return {"profiles": profiles, "categories": categories}


@frappe.whitelist()
def get_profile_data(profile):
    assignments = frappe.get_all(
        "Nexus AI Agent Profile Access Category",
        filters={"ai_agent_profile": profile},
        fields=["name", "access_category", "enabled", "priority"],
        order_by="priority asc",
    )

    effective = _get_effective_policies(profile)

    return {"assignments": assignments, "effective_policies": effective}


@frappe.whitelist()
def save_profile_access_categories(profile, categories_to_assign, assignments_to_disable):
    import json

    to_assign = json.loads(categories_to_assign or "[]")
    to_disable = json.loads(assignments_to_disable or "[]")

    for cat in to_assign:
        existing = frappe.db.get_value(
            "Nexus AI Agent Profile Access Category",
            {"ai_agent_profile": profile, "access_category": cat},
            "name",
        )
        if existing:
            frappe.db.set_value(
                "Nexus AI Agent Profile Access Category", existing, "enabled", 1
            )
        else:
            doc = frappe.new_doc("Nexus AI Agent Profile Access Category")
            doc.ai_agent_profile = profile
            doc.access_category = cat
            doc.enabled = 1
            doc.insert(ignore_permissions=True)

    for rec_name in to_disable:
        frappe.db.set_value(
            "Nexus AI Agent Profile Access Category", rec_name, "enabled", 0
        )

    frappe.db.commit()

    assignments = frappe.get_all(
        "Nexus AI Agent Profile Access Category",
        filters={"ai_agent_profile": profile},
        fields=["name", "access_category", "enabled", "priority"],
        order_by="priority asc",
    )

    return {
        "status": "success",
        "assignments": assignments,
        "effective_policies": _get_effective_policies(profile),
    }


@frappe.whitelist()
def get_effective_policies(profile):
    return {"policies": list(_get_effective_policies(profile))}


@frappe.whitelist()
def get_category_policies(category):
    rows = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": category, "parentfield": "allowed_policies"},
        fields=["access_policy"],
        pluck="access_policy",
    )

    policies = []
    for name in rows:
        doc = frappe.db.get_value(
            "Nexus Access Policy",
            name,
            ["policy_name", "access_level", "sensitivity", "is_primitive", "disabled", "description"],
            as_dict=True,
        )
        if doc:
            policies.append(doc)

    return {"policies": policies}


def _get_effective_policies(profile):
    category_names = frappe.get_all(
        "Nexus AI Agent Profile Access Category",
        filters={"ai_agent_profile": profile, "enabled": 1},
        pluck="access_category",
    )

    if not category_names:
        return []

    policy_names = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": ["in", category_names], "parentfield": "allowed_policies"},
        pluck="access_policy",
    )

    if not policy_names:
        return []

    return frappe.get_all(
        "Nexus Access Policy",
        filters={"policy_name": ["in", list(set(policy_names))], "disabled": 0},
        fields=["policy_name", "access_level", "sensitivity", "is_primitive", "description"],
        order_by="policy_name asc",
    )
