import json

import frappe

from digitz_ai_nexus_live.services.identity_resolver import get_enabled_identity_types


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
            "customer",
            "contact",
            "enabled",
            "verification_status",
            "modified",
        ],
        order_by="modified desc",
        limit_page_length=50,
    )

    return {
        "registries": registries,
        "identity_types": get_enabled_identity_types(),
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
            "customer": doc.customer,
            "contact": doc.contact,
            "mobile_no": doc.mobile_no,
            "enabled": doc.enabled,
            "verification_status": doc.verification_status,
            "verified_on": doc.verified_on,
            "notes": doc.notes,
        },
        "identities": [
            {
                "name": row.name,
                "identity_type": row.identity_type,
                "enabled": row.enabled,
                "is_primary": row.is_primary,
                "verification_method": row.verification_method,
                "valid_from": row.valid_from,
                "valid_until": row.valid_until,
                "reference_doctype": row.reference_doctype,
                "reference_name": row.reference_name,
                "notes": row.notes,
            }
            for row in doc.identities
        ],
    }


@frappe.whitelist()
def save_registry(registry, identities):
    registry_data = json.loads(registry or "{}")
    identity_rows = json.loads(identities or "[]")

    name = registry_data.get("name")
    if name and frappe.db.exists("Nexus Identity Registry", name):
        doc = frappe.get_doc("Nexus Identity Registry", name)
    else:
        doc = frappe.new_doc("Nexus Identity Registry")

    doc.email = (registry_data.get("email") or "").strip().lower()
    doc.full_name = registry_data.get("full_name")
    doc.user = registry_data.get("user")
    doc.customer = registry_data.get("customer")
    doc.contact = registry_data.get("contact")
    doc.mobile_no = registry_data.get("mobile_no")
    doc.enabled = int(registry_data.get("enabled") or 0)
    doc.verification_status = registry_data.get("verification_status") or "Unverified"
    doc.notes = registry_data.get("notes")

    doc.set("identities", [])
    for row in identity_rows:
        if not row.get("identity_type"):
            continue

        doc.append("identities", {
            "identity_type": row.get("identity_type"),
            "enabled": int(row.get("enabled") or 0),
            "is_primary": int(row.get("is_primary") or 0),
            "verification_method": row.get("verification_method"),
            "valid_from": row.get("valid_from"),
            "valid_until": row.get("valid_until"),
            "reference_doctype": row.get("reference_doctype"),
            "reference_name": row.get("reference_name"),
            "notes": row.get("notes"),
        })

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def toggle_registry(name, enabled):
    frappe.db.set_value("Nexus Identity Registry", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}
