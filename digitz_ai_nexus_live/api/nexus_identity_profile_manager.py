import json
import frappe


@frappe.whitelist()
def get_page_data():
    from digitz_ai_nexus_live.api.nexus_profile_access_allocation import get_available_tenants

    tenant_data = get_available_tenants()

    identity_types = frappe.get_all(
        "Nexus Identity Type",
        fields=["name"],
        order_by="name asc",
    )

    knowledge_profiles = frappe.get_all(
        "Knowledge Profile",
        fields=["name", "profile_name", "tenant"],
        order_by="profile_name asc",
    )

    return {
        "tenants": tenant_data.get("tenants") or [],
        "default_tenant": tenant_data.get("default_tenant") or "",
        "identity_types": [t.name for t in identity_types],
        "knowledge_profiles": knowledge_profiles,
    }


@frappe.whitelist()
def get_profiles(tenant=None):
    filters = {}
    if tenant:
        filters["tenant"] = tenant

    profiles = frappe.get_all(
        "Nexus Identity Profile",
        filters=filters,
        fields=["name", "profile_name", "tenant", "title", "enabled", "description"],
        order_by="profile_name asc",
    )

    for p in profiles:
        p["mapping_count"] = frappe.db.count(
            "Nexus Identity Profile Mapping", filters={"parent": p.name}
        )

    return {"profiles": profiles}


@frappe.whitelist()
def get_profile(name):
    doc = frappe.get_doc("Nexus Identity Profile", name)

    return {
        "profile": {
            "name": doc.name,
            "profile_name": doc.profile_name,
            "tenant": doc.tenant,
            "title": doc.title or "",
            "enabled": doc.enabled,
            "description": doc.description or "",
        },
        "mappings": [
            {
                "identity_type": row.identity_type or "",
                "knowledge_profile": row.knowledge_profile or "",
            }
            for row in (doc.identity_mappings or [])
        ],
    }


@frappe.whitelist()
def save_profile(profile, mappings):
    profile_data = json.loads(profile or "{}")
    mapping_rows = json.loads(mappings or "[]")

    name = profile_data.get("name")
    if name and frappe.db.exists("Nexus Identity Profile", name):
        doc = frappe.get_doc("Nexus Identity Profile", name)
    else:
        doc = frappe.new_doc("Nexus Identity Profile")

    doc.profile_name = (profile_data.get("profile_name") or "").strip()
    doc.tenant = profile_data.get("tenant") or ""
    doc.title = (profile_data.get("title") or "").strip()
    doc.enabled = int(profile_data.get("enabled") or 0)
    doc.description = (profile_data.get("description") or "").strip()

    doc.set("identity_mappings", [])
    for row in mapping_rows:
        identity_type = (row.get("identity_type") or "").strip()
        knowledge_profile = (row.get("knowledge_profile") or "").strip()
        if not identity_type or not knowledge_profile:
            continue
        rule_ref = frappe.db.get_value(
            "Nexus Identity Knowledge Rule",
            {"identity_type": identity_type, "knowledge_profile": knowledge_profile},
            "name",
        ) or None
        doc.append("identity_mappings", {
            "identity_type": identity_type,
            "knowledge_profile": knowledge_profile,
            "knowledge_access_rule": rule_ref,
        })

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def delete_profile(name):
    if not frappe.db.exists("Nexus Identity Profile", name):
        frappe.throw("Profile not found.")
    frappe.delete_doc("Nexus Identity Profile", name, ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def toggle_profile(name, enabled):
    if not frappe.db.exists("Nexus Identity Profile", name):
        frappe.throw("Profile not found.")
    frappe.db.set_value("Nexus Identity Profile", name, "enabled", int(enabled))
    frappe.db.commit()
    return {"status": "success"}
