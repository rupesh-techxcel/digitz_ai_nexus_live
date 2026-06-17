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

    if assignments:
        assignment_names = [a["name"] for a in assignments]

        cat_rows = frappe.get_all(
            "Nexus Chat Category Link",
            filters={"parent": ["in", assignment_names], "parenttype": "Nexus User Profile Assignment"},
            fields=["parent", "chat_category"],
            order_by="idx asc",
        )

        cat_names = list({r["chat_category"] for r in cat_rows if r.get("chat_category")})
        cat_labels = {}
        if cat_names:
            for row in frappe.get_all(
                "Nexus Chat Category",
                filters={"name": ["in", cat_names]},
                fields=["name", "category_label"],
            ):
                cat_labels[row["name"]] = row.get("category_label") or row["name"]

        from collections import defaultdict
        cats_by_assignment = defaultdict(list)
        for r in cat_rows:
            if r.get("chat_category"):
                cats_by_assignment[r["parent"]].append({
                    "name": r["chat_category"],
                    "label": cat_labels.get(r["chat_category"], r["chat_category"]),
                })

        for a in assignments:
            a["escalation_categories"] = cats_by_assignment.get(a["name"], [])

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
