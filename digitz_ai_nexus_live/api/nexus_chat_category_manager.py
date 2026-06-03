import frappe


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

    return {"channels": channels, "profiles": profiles}


@frappe.whitelist()
def get_channel_categories(channel):
    categories = frappe.get_all(
        "Nexus Chat Category",
        filters={"channel": channel},
        fields=[
            "name", "category_code", "category_label",
            "identity_type", "ai_agent_profile",
            "display_order", "enabled", "description",
        ],
        order_by="display_order asc",
    )
    return {"categories": categories}


@frappe.whitelist()
def save_category(
    channel,
    category_label,
    identity_type,
    ai_agent_profile,
    display_order,
    description,
    enabled,
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
    doc.identity_type = identity_type
    doc.ai_agent_profile = ai_agent_profile
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
