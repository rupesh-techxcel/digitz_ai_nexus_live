import frappe


@frappe.whitelist()
def get_page_data():
    users = frappe.get_all(
        "User",
        filters={"enabled": 1, "user_type": "System User", "name": ["!=", "Guest"]},
        fields=["name", "full_name", "email", "user_type"],
        order_by="full_name asc",
    )

    profiles = frappe.get_all(
        "Knowledge Profile",
        filters={"enabled": 1},
        fields=["name", "title", "description"],
        order_by="name asc",
    )

    assignments = frappe.get_all(
        "Nexus User Profile Assignment",
        fields=["name", "user", "knowledge_profile", "active", "assigned_on", "notes"],
    )

    assignment_map = {}
    for a in assignments:
        if a.active and a.user not in assignment_map:
            assignment_map[a.user] = a

    return {
        "users": users,
        "profiles": profiles,
        "assignment_map": assignment_map,
    }


@frappe.whitelist()
def get_user_data(user):
    assignments = frappe.get_all(
        "Nexus User Profile Assignment",
        filters={"user": user},
        fields=["name", "user", "knowledge_profile", "active", "assigned_by", "assigned_on", "notes"],
        order_by="assigned_on desc",
    )

    effective_policies = []
    active = next((a for a in assignments if a.active), None)

    if active and active.knowledge_profile:
        category_names = frappe.get_all(
            "Knowledge Profile Access Category",
            filters={
                "parent": active.knowledge_profile,
                "parentfield": "access_categories",
                "enabled": 1,
            },
            pluck="access_category",
        )
        if category_names:
            policy_names = frappe.get_all(
                "Nexus Access Category Policy",
                filters={"parent": ["in", category_names], "parentfield": "allowed_policies"},
                pluck="access_policy",
            )
            if policy_names:
                effective_policies = frappe.get_all(
                    "Nexus Access Policy",
                    filters={"policy_name": ["in", list(set(policy_names))], "disabled": 0},
                    fields=["policy_name", "access_level", "sensitivity", "is_primitive"],
                    order_by="policy_name asc",
                )

    return {
        "assignments": assignments,
        "effective_policies": effective_policies,
        "active_profile": active.knowledge_profile if active else None,
    }


@frappe.whitelist()
def assign_profile(user, knowledge_profile, notes=None):
    existing = frappe.db.get_value(
        "Nexus User Profile Assignment",
        {"user": user, "active": 1},
        "name",
    )
    if existing:
        frappe.db.set_value("Nexus User Profile Assignment", existing, "active", 0)

    doc = frappe.new_doc("Nexus User Profile Assignment")
    doc.user = user
    doc.knowledge_profile = knowledge_profile
    doc.active = 1
    doc.notes = notes or ""
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def deactivate_assignment(name):
    if not frappe.db.exists("Nexus User Profile Assignment", name):
        frappe.throw("Assignment not found.")
    frappe.db.set_value("Nexus User Profile Assignment", name, "active", 0)
    frappe.db.commit()
    return {"status": "success"}
