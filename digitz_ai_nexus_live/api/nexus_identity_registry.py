import json

import frappe


@frappe.whitelist()
def get_page_data(search=None):
    filters = {}
    if search:
        filters["email"] = ["like", f"%{search.strip().lower()}%"]

    registries = frappe.get_all(
        "Nexus Identity Registry",
        filters=filters,
        fields=[
            "name",
            "email",
            "full_name",
            "user",
            "reference_doctype",
            "reference_name",
            "reference_label",
            "contact",
            "enabled",
            "verification_status",
            "modified",
        ],
        order_by="modified desc",
        limit_page_length=50,
    )

    identity_profiles = frappe.get_all(
        "Nexus Identity Profile",
        filters={"enabled": 1},
        fields=["name", "profile_name", "title"],
        order_by="profile_name asc",
    )

    return {
        "registries": registries,
        "identity_profiles": identity_profiles,
    }


@frappe.whitelist()
def get_registry(name):
    doc = frappe.get_doc("Nexus Identity Registry", name)

    return {
        "registry": {
            "name": doc.name,
            "email": doc.email,
            "full_name": doc.full_name,
            "user": doc.user,
            "reference_doctype": doc.reference_doctype,
            "reference_name": doc.reference_name,
            "reference_label": doc.reference_label,
            "contact": doc.contact,
            "mobile_no": doc.mobile_no,
            "enabled": doc.enabled,
            "verification_status": doc.verification_status,
            "verified_on": doc.verified_on,
            "notes": doc.notes,
        },
        "identity_profiles": [
            {
                "name": row.name,
                "identity_profile": row.identity_profile,
                "is_primary": row.is_primary,
                "valid_from": row.valid_from,
                "valid_until": row.valid_until,
            }
            for row in doc.identity_profiles
        ],
    }


@frappe.whitelist()
def save_registry(registry, identity_profiles):
    registry_data = json.loads(registry or "{}")
    profile_rows = json.loads(identity_profiles or "[]")

    name = registry_data.get("name")
    if name and frappe.db.exists("Nexus Identity Registry", name):
        doc = frappe.get_doc("Nexus Identity Registry", name)
    else:
        doc = frappe.new_doc("Nexus Identity Registry")

    doc.email = (registry_data.get("email") or "").strip().lower()
    doc.full_name = registry_data.get("full_name")
    doc.user = registry_data.get("user")
    doc.reference_doctype = registry_data.get("reference_doctype")
    doc.reference_name = registry_data.get("reference_name")
    doc.reference_label = registry_data.get("reference_label")
    doc.contact = registry_data.get("contact")
    doc.mobile_no = registry_data.get("mobile_no")
    doc.enabled = int(registry_data.get("enabled") or 0)
    doc.verification_status = registry_data.get("verification_status") or "Unverified"
    doc.notes = registry_data.get("notes")

    doc.set("identity_profiles", [])
    for row in profile_rows:
        if not row.get("identity_profile"):
            continue

        doc.append("identity_profiles", {
            "identity_profile": row.get("identity_profile"),
            "is_primary": int(row.get("is_primary") or 0),
            "valid_from": row.get("valid_from"),
            "valid_until": row.get("valid_until"),
        })

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def toggle_registry(name, enabled):
    frappe.db.set_value("Nexus Identity Registry", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}
