import frappe


@frappe.whitelist()
def get_page_data():
    """Return all Knowledge Profiles and all enabled Access Categories."""
    profiles = []
    if frappe.db.exists("DocType", "Knowledge Profile"):
        raw = frappe.get_all(
            "Knowledge Profile",
            fields=["name", "profile_name", "title", "enabled"],
            order_by="profile_name asc",
        )
        for p in raw:
            cat_count = frappe.db.count(
                "Knowledge Profile Access Category",
                {"parent": p.name, "enabled": 1},
            ) if frappe.db.exists("DocType", "Knowledge Profile Access Category") else 0
            profiles.append({
                "name":       p.name,
                "title":      p.title or p.profile_name,
                "enabled":    bool(p.enabled),
                "cat_count":  cat_count,
            })

    categories = frappe.get_all(
        "Nexus Access Category",
        filters={"disabled": 0},
        fields=["name", "category_name", "title", "description", "priority"],
        order_by="priority asc",
    )

    return {"profiles": profiles, "categories": categories}


@frappe.whitelist()
def get_profile_detail(profile):
    """
    Return full detail for one Knowledge Profile:
    - assigned access categories
    - resolved effective policies
    - identity profiles that reference this Knowledge Profile
    """
    if not frappe.db.exists("Knowledge Profile", profile):
        frappe.throw(f"Knowledge Profile '{profile}' not found.")

    doc = frappe.get_doc("Knowledge Profile", profile)

    assignments = []
    for row in (doc.access_categories or []):
        assignments.append({
            "access_category": row.access_category,
            "enabled": bool(row.enabled),
        })

    effective_policies = _get_effective_policies_for_kp(profile)

    # Find Identity Profiles that map to this Knowledge Profile
    identity_profile_refs = []
    if frappe.db.exists("DocType", "Nexus Identity Profile Mapping"):
        rows = frappe.get_all(
            "Nexus Identity Profile Mapping",
            filters={"knowledge_profile": profile},
            fields=["parent", "identity_type"],
        )
        for row in rows:
            ip_title = frappe.db.get_value(
                "Nexus Identity Profile", row.parent, "title"
            ) or row.parent
            identity_profile_refs.append({
                "identity_profile":       row.parent,
                "identity_profile_title": ip_title,
                "identity_type":          row.identity_type,
            })

    return {
        "name":               doc.name,
        "title":              doc.title or doc.profile_name,
        "enabled":            bool(doc.enabled),
        "description":        doc.description or "",
        "assignments":        assignments,
        "effective_policies": effective_policies,
        "used_by":            identity_profile_refs,
    }


@frappe.whitelist()
def save_knowledge_profile_categories(profile, categories_to_assign, categories_to_remove):
    """
    Assign or remove Access Categories on a Knowledge Profile.
    categories_to_assign / categories_to_remove are JSON arrays of category names.
    """
    import json

    to_assign = json.loads(categories_to_assign or "[]")
    to_remove = json.loads(categories_to_remove or "[]")

    if not frappe.db.exists("Knowledge Profile", profile):
        frappe.throw(f"Knowledge Profile '{profile}' not found.")

    doc = frappe.get_doc("Knowledge Profile", profile)

    existing = {row.access_category: row for row in (doc.access_categories or [])}

    for cat in to_assign:
        if cat in existing:
            existing[cat].enabled = 1
        else:
            doc.append("access_categories", {
                "access_category": cat,
                "enabled": 1,
            })

    for cat in to_remove:
        if cat in existing:
            existing[cat].enabled = 0

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return get_profile_detail(profile)


@frappe.whitelist()
def create_knowledge_profile(profile_name, title, description=""):
    """Create a new Knowledge Profile."""
    profile_name = (profile_name or "").strip().upper().replace(" ", "-")
    if not profile_name:
        frappe.throw("Profile name is required.")

    if frappe.db.exists("Knowledge Profile", profile_name):
        frappe.throw(f"Knowledge Profile '{profile_name}' already exists.")

    doc = frappe.new_doc("Knowledge Profile")
    doc.profile_name = profile_name
    doc.title = title or profile_name
    doc.description = description
    doc.enabled = 1
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "title": doc.title}


@frappe.whitelist()
def get_category_policies(category):
    """Return policies belonging to an Access Category."""
    rows = frappe.get_all(
        "Nexus Access Category Policy",
        filters={"parent": category, "parentfield": "allowed_policies"},
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


def _get_effective_policies_for_kp(profile_name):
    """Resolve effective policies for a Knowledge Profile via its access categories."""
    category_names = frappe.get_all(
        "Knowledge Profile Access Category",
        filters={"parent": profile_name, "enabled": 1},
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
