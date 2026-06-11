import frappe


@frappe.whitelist()
def get_page_data():
    users = frappe.get_all(
        "User",
        filters={"enabled": 1, "user_type": "System User", "name": ["!=", "Guest"]},
        fields=["name", "full_name", "email", "user_type"],
        order_by="full_name asc",
    )

    assignments = frappe.get_all(
        "Nexus User Profile Assignment",
        fields=["name", "user", "active", "assigned_on", "notes"],
    )

    assignment_map = {}
    for a in assignments:
        if a.active and a.user not in assignment_map:
            assignment_map[a.user] = a

    return {
        "users": users,
        "assignment_map": assignment_map,
    }


@frappe.whitelist()
def get_user_data(user):
    assignments = frappe.get_all(
        "Nexus User Profile Assignment",
        filters={"user": user},
        fields=["name", "user", "active", "assigned_by", "assigned_on", "notes",
                "can_handle_escalations", "max_escalation_sessions"],
        order_by="assigned_on desc",
    )

    return {
        "assignments": assignments,
    }


@frappe.whitelist()
def deactivate_assignment(name):
    if not frappe.db.exists("Nexus User Profile Assignment", name):
        frappe.throw("Assignment not found.")
    frappe.db.set_value("Nexus User Profile Assignment", name, "active", 0)
    frappe.db.commit()
    return {"status": "success"}
